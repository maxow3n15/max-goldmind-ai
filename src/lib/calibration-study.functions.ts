// Walk-forward calibration study.
//
// Runs the real pipeline replay over sequential chunks of history, calibrating
// on the leading chunks and reporting the held-out final chunk separately, so
// in-sample and out-of-sample performance are always shown side by side with
// their sample sizes.
//
// SAFETY: nothing here can loosen a live gate. The confidence floor, R:R
// minimum, loss limits and kill switch are untouched. `researchFloor` only
// affects THIS replay — it exists so the study can measure the population of
// setups the live gate rejects, which is otherwise invisible.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CONFIDENCE_GATES } from "@/lib/services/scoring";
import { MIN_MEANINGFUL_SAMPLE, type ModelStats } from "@/lib/backtest/pipeline-engine";

const GOLD_SYMBOL = "GC=F";

const INTERVALS: Record<string, string> = { "15": "15m", "30": "30m", "60": "60m", "240": "1h" };
const RANGES: Record<string, string> = { "15": "60d", "30": "60d", "60": "2y", "240": "2y" };

/**
 * Timeframes below the execution resolution cannot be reconstructed by
 * aggregation, so they are fetched as independent historical series — the same
 * thing the live path does. Without them `mtf.degraded` is true on every bar
 * and the 15-point HTF-alignment factor is excluded from every score.
 */
const FINER: Record<string, { tf: string; interval: string; range: string }[]> = {
  "15": [
    { tf: "5", interval: "5m", range: "60d" },
    { tf: "1", interval: "1m", range: "7d" },
  ],
  "30": [
    { tf: "15", interval: "15m", range: "60d" },
    { tf: "5", interval: "5m", range: "60d" },
  ],
  "60": [
    { tf: "30", interval: "30m", range: "60d" },
    { tf: "15", interval: "15m", range: "60d" },
  ],
  "240": [
    { tf: "60", interval: "60m", range: "2y" },
    { tf: "30", interval: "30m", range: "60d" },
  ],
};

const Input = z.object({
  timeframe: z.enum(["15", "30", "60", "240"]).default("60"),
  chunks: z.number().int().min(4).max(8).default(4),
  /** Measurement floor. Never below 50; never applied to live trading. */
  researchFloor: z.number().min(50).max(99).default(CONFIDENCE_GATES.FINAL),
  realCorrelation: z.boolean().default(true),
  /**
   * 0 = provider default window (Yahoo). >0 = pull that many days of bid/ask
   * history from the user's OANDA connection instead — up to ~8 years.
   */
  longHistoryDays: z.number().int().min(0).max(2922).default(0),
});

export interface ChunkReport {
  chunk: number;
  role: "train" | "holdout";
  from: string;
  to: string;
  bars: number;
  candidates: number;
  approved: number;
  trades: number;
  winRate: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdownPct: number;
  netPnl: number;
  confidenceP90: number;
  confidenceMax: number;
  models: ModelStats[];
  /** Data-fidelity diagnostics for this chunk. */
  mtfDegradedFraction: number;
  htfAlignmentVerdicts: { verdict: string; count: number }[];
}

export interface CalibrationStudy {
  ok: true;
  timeframe: string;
  liveFloor: number;
  researchFloor: number;
  bars: number;
  from: string | null;
  to: string | null;
  chunks: ChunkReport[];
  inSample: { trades: number; winRate: number; expectancyR: number; netPnl: number };
  outOfSample: { trades: number; winRate: number; expectancyR: number; netPnl: number };
  /** Per-model in-sample vs out-of-sample validity. */
  models: {
    model: string;
    inSample: ModelStats | null;
    outOfSample: ModelStats | null;
    sufficientSample: boolean;
  }[];
  rejections: { reason: string; count: number }[];
  minMeaningfulSample: number;
  verdict: string;
  /** Whether the replay's own market view was complete enough to score HTF. */
  dataFidelity: {
    finerSeriesLoaded: string[];
    finerSeriesMissing: string[];
    mtfDegradedFraction: number;
    htfAlignmentVerdicts: { verdict: string; count: number }[];
  };
  caveats: string[];
}

function aggregate(rows: ChunkReport[]) {
  const trades = rows.reduce((a, r) => a + r.trades, 0);
  const netPnl = Number(rows.reduce((a, r) => a + r.netPnl, 0).toFixed(2));
  const wins = rows.reduce((a, r) => a + (r.winRate / 100) * r.trades, 0);
  const expR = trades ? rows.reduce((a, r) => a + r.expectancyR * r.trades, 0) / trades : 0;
  return {
    trades,
    winRate: trades ? Number(((wins / trades) * 100).toFixed(1)) : 0,
    expectancyR: Number(expR.toFixed(3)),
    netPnl,
  };
}

function mergeModels(rows: ChunkReport[]): Map<string, ModelStats> {
  const out = new Map<string, ModelStats>();
  for (const r of rows) {
    for (const m of r.models) {
      const cur = out.get(m.model) ?? {
        model: m.model, trades: 0, wins: 0, winRate: 0, expectancyR: 0, netPnl: 0, sufficientSample: false,
      };
      const totalR = cur.expectancyR * cur.trades + m.expectancyR * m.trades;
      cur.trades += m.trades;
      cur.wins += m.wins;
      cur.netPnl = Number((cur.netPnl + m.netPnl).toFixed(2));
      cur.expectancyR = cur.trades ? Number((totalR / cur.trades).toFixed(3)) : 0;
      cur.winRate = cur.trades ? Number(((cur.wins / cur.trades) * 100).toFixed(1)) : 0;
      cur.sufficientSample = cur.trades >= MIN_MEANINGFUL_SAMPLE;
      out.set(m.model, cur);
    }
  }
  return out;
}

export const runCalibrationStudy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    const { fetchCandles } = await import("@/lib/candles.server");
    const { runPipelineBacktest, DEFAULT_PIPELINE_CONFIG } = await import("@/lib/backtest/pipeline-engine");
    const { buildFidelityCaveats } = await import("@/lib/backtest/pipeline-adapter");

    const interval = INTERVALS[data.timeframe] ?? "60m";
    const range = RANGES[data.timeframe] ?? "2y";
    const longDays = data.longHistoryDays;

    // Long-history mode: bid/ask candles paged backwards from the user's own
    // OANDA connection. The pager caps at 40 × 5000 bars, so very fine
    // timeframes simply return fewer years — reported, never faked.
    let oanda: { credentials: Record<string, string>; environment: string } | null = null;
    if (longDays > 0) {
      const { loadDefaultBrokerConnection, resolveConnectionEnvironment } =
        await import("@/lib/brokers/live-execution.server");
      const conn = await loadDefaultBrokerConnection(context.supabase, context.userId).catch(() => null);
      if (!conn || conn.broker_id !== "oanda") {
        return { ok: false as const, reason: "Long-history studies need a default OANDA connection." };
      }
      const resolved = await resolveConnectionEnvironment(conn);
      oanda = {
        credentials: resolved.credentials,
        environment: resolved.env.endsWith("_live") ? "live" : "practice",
      };
    }

    const { fetchOandaHistory } = await import("@/lib/backtest/oanda-history.server");
    const candles = oanda
      ? (await fetchOandaHistory({ credentials: oanda.credentials, environment: oanda.environment, timeframe: data.timeframe, days: longDays })).candles
      : await fetchCandles(GOLD_SYMBOL, interval, range, 300_000);
    if (candles.length < 2_000) {
      return { ok: false as const, reason: "Not enough history for a walk-forward study on this timeframe." };
    }

    // Independent per-timeframe history for everything below the execution
    // resolution. Missing legs are reported, never faked.
    const finerSeries: Record<string, any[]> = {};
    const finerLoaded: string[] = [];
    const finerMissing: string[] = [];
    for (const spec of FINER[data.timeframe] ?? []) {
      const c = oanda
        ? await fetchOandaHistory({ credentials: oanda.credentials, environment: oanda.environment, timeframe: spec.tf, days: longDays })
            .then((h) => h.candles)
            .catch(() => [])
        : await fetchCandles(GOLD_SYMBOL, spec.interval, spec.range, 300_000).catch(() => []);
      if (c.length >= 200) {
        finerSeries[spec.tf] = c;
        finerLoaded.push(`${spec.tf}m (${c.length} bars${oanda ? `, ${longDays}d OANDA` : `, ${spec.range}`})`);
      } else {
        finerMissing.push(`${spec.tf}m`);
      }
    }

    let correlation: any = null;
    if (data.realCorrelation) {
      const { ReplayCorrelation, loadCorrelationSeries } = await import("@/lib/backtest/replay-correlation");
      const series = await loadCorrelationSeries(interval, range);
      if (series.length) correlation = new ReplayCorrelation(series);
    }

    const floor = Math.max(50, Math.round(data.researchFloor));
    const size = Math.floor(candles.length / data.chunks);
    const rejections = new Map<string, number>();
    const reports: ChunkReport[] = [];

    for (let i = 0; i < data.chunks; i++) {
      const slice = candles.slice(i * size, i === data.chunks - 1 ? candles.length : (i + 1) * size);
      const r = runPipelineBacktest(slice, {
        ...DEFAULT_PIPELINE_CONFIG,
        timeframe: data.timeframe as any,
        correlation,
        finerSeries: finerSeries as any,
        researchConfidenceFloor: floor,
        settings: { confidence_threshold: floor },
        caveats: buildFidelityCaveats({ realCorrelation: !!correlation }),
      });
      for (const rej of r.rejections) rejections.set(rej.reason, (rejections.get(rej.reason) ?? 0) + rej.count);
      reports.push({
        chunk: i + 1,
        role: i === data.chunks - 1 ? "holdout" : "train",
        from: new Date(slice[0].t).toISOString().slice(0, 10),
        to: new Date(slice[slice.length - 1].t).toISOString().slice(0, 10),
        bars: slice.length,
        candidates: r.candidateBars,
        approved: r.approvedBars,
        trades: r.metrics.trades,
        winRate: r.metrics.winRate,
        expectancyR: r.metrics.expectancyR,
        profitFactor: r.metrics.profitFactor,
        maxDrawdownPct: r.metrics.maxDrawdownPct,
        netPnl: r.metrics.netPnl,
        confidenceP90: r.confidence.p90,
        confidenceMax: r.confidence.max,
        models: r.modelStats,
        mtfDegradedFraction: r.dataFidelity.mtfDegradedFraction,
        htfAlignmentVerdicts: r.dataFidelity.htfAlignmentVerdicts,
      });
    }

    const train = reports.filter((r) => r.role === "train");
    const holdout = reports.filter((r) => r.role === "holdout");
    const inSample = aggregate(train);
    const outOfSample = aggregate(holdout);

    const isModels = mergeModels(train);
    const oosModels = mergeModels(holdout);
    const models = [...new Set([...isModels.keys(), ...oosModels.keys()])].map((model) => {
      const a = isModels.get(model) ?? null;
      const b = oosModels.get(model) ?? null;
      return {
        model,
        inSample: a,
        outOfSample: b,
        sufficientSample: (a?.trades ?? 0) + (b?.trades ?? 0) >= MIN_MEANINGFUL_SAMPLE,
      };
    }).sort((x, y) => (y.inSample?.trades ?? 0) - (x.inSample?.trades ?? 0));

    const total = inSample.trades + outOfSample.trades;
    const verdict =
      total < MIN_MEANINGFUL_SAMPLE
        ? `Insufficient sample — ${total} closed trades across the whole study, below the ${MIN_MEANINGFUL_SAMPLE}-trade minimum. No weight or exit parameter may be tuned on this evidence.`
        : outOfSample.expectancyR < inSample.expectancyR - 0.3
          ? "Held-out expectancy is materially worse than in-sample expectancy — treat any tuning done on the training chunks as overfitted."
          : "Held-out performance is broadly consistent with the training chunks. Historical only; not a forecast.";

    return {
      ok: true as const,
      timeframe: data.timeframe,
      liveFloor: CONFIDENCE_GATES.FINAL,
      researchFloor: floor,
      bars: candles.length,
      from: new Date(candles[0].t).toISOString().slice(0, 10),
      to: new Date(candles[candles.length - 1].t).toISOString().slice(0, 10),
      chunks: reports,
      inSample,
      outOfSample,
      models,
      rejections: [...rejections.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 10),
      minMeaningfulSample: MIN_MEANINGFUL_SAMPLE,
      verdict,
      dataFidelity: {
        finerSeriesLoaded: finerLoaded,
        finerSeriesMissing: finerMissing,
        mtfDegradedFraction: reports.length
          ? Number(
              (
                reports.reduce((a, r) => a + r.mtfDegradedFraction * r.candidates, 0) /
                Math.max(1, reports.reduce((a, r) => a + r.candidates, 0))
              ).toFixed(4),
            )
          : 0,
        htfAlignmentVerdicts: (() => {
          const m = new Map<string, number>();
          for (const r of reports) for (const v of r.htfAlignmentVerdicts) m.set(v.verdict, (m.get(v.verdict) ?? 0) + v.count);
          return [...m.entries()].map(([verdict, count]) => ({ verdict, count })).sort((a, b) => b.count - a.count);
        })(),
      },
      caveats: buildFidelityCaveats({ realCorrelation: !!correlation }),
    } satisfies CalibrationStudy;
  });
