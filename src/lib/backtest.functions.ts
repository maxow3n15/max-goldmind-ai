import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEFAULT_BACKTEST_CONFIG, type BacktestResult } from "@/lib/backtest/engine";
import { limitsFromSettings } from "@/lib/services/risk-engine";

const GOLD_SYMBOL = "GC=F";

/**
 * How much history the upstream chart API will actually serve per interval.
 * Intraday intervals are capped at ~60 days (1m at ~7), so offering "1y" on a
 * 15-minute backtest silently returned 60 days of data and mislabelled it.
 */
export const PERIODS_BY_TIMEFRAME: Record<string, readonly string[]> = {
  "5": ["1mo", "60d"],
  "15": ["1mo", "60d"],
  "30": ["1mo", "60d"],
  "60": ["1mo", "3mo", "6mo", "1y", "2y"],
  "240": ["1mo", "3mo", "6mo", "1y", "2y"],
};

const RunInput = z.object({
  mode: z.enum(["classic", "pipeline"]).default("classic"),
  timeframe: z.enum(["5", "15", "30", "60", "240"]).default("15"),
  period: z.enum(["1mo", "60d", "3mo", "6mo", "1y", "2y"]).default("1mo"),
  startingBalance: z.number().min(100).max(10_000_000).default(10_000),
  riskPerTradePct: z.number().min(0.1).max(2).default(0.5),
  rrTarget: z.number().min(1).max(6).default(2),
  atrStopMultiple: z.number().min(0.5).max(5).default(1.5),
  minConfidence: z.number().min(50).max(99).default(88),
  costPerTrade: z.number().min(0).max(5).default(0.35),
  useTrailingStop: z.boolean().default(true),
  londonNyOnly: z.boolean().default(true),
  label: z.string().max(80).optional(),
  save: z.boolean().default(true),
});

const INTERVALS: Record<string, string> = { "5": "5m", "15": "15m", "30": "30m", "60": "60m", "240": "1h" };

export const runBacktestFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RunInput.parse(d))
  .handler(async ({ data, context }) => {
    const startedAt = Date.now();
    const { fetchCandles } = await import("@/lib/candles.server");
    const { runBacktest } = await import("@/lib/backtest/engine");

    const allowed = PERIODS_BY_TIMEFRAME[data.timeframe] ?? ["1mo"];
    if (!allowed.includes(data.period)) {
      return {
        ok: false as const,
        reason: `The data provider only serves ${allowed.join(" / ")} of history at ${data.timeframe}m candles.`,
      };
    }

    const candles = await fetchCandles(
      GOLD_SYMBOL,
      INTERVALS[data.timeframe] ?? "15m",
      data.period,
      300_000,
    );
    if (candles.length < 250) {
      return { ok: false as const, reason: "Not enough historical candles for this timeframe and period." };
    }

    const { data: settings } = await context.supabase
      .from("user_settings").select("*").eq("user_id", context.userId).maybeSingle();

    const limits = limitsFromSettings(settings);
    limits.riskPerTradePct = Math.min(data.riskPerTradePct, limits.maxRiskPerTradePct);

    const config = {
      ...DEFAULT_BACKTEST_CONFIG,
      limits,
      startingBalance: data.startingBalance,
      rrTarget: data.rrTarget,
      atrStopMultiple: data.atrStopMultiple,
      minConfidence: data.minConfidence,
      costPerTrade: data.costPerTrade,
      useTrailingStop: data.useTrailingStop,
      sessions: data.londonNyOnly ? [{ from: 7, to: 21 }] : [],
    };

    let result: BacktestResult;
    if (data.mode === "pipeline") {
      const { runPipelineBacktest, DEFAULT_PIPELINE_CONFIG } = await import("@/lib/backtest/pipeline-engine");
      result = runPipelineBacktest(candles, {
        ...DEFAULT_PIPELINE_CONFIG,
        timeframe: data.timeframe as any,
        startingBalance: data.startingBalance,
        costPerTrade: data.costPerTrade,
        settings: {
          risk_per_trade: data.riskPerTradePct,
          min_risk_reward: data.rrTarget,
          confidence_threshold: data.minConfidence,
          max_open_trades: Number((settings as any)?.max_open_trades ?? 3),
          max_trades_per_day: Number((settings as any)?.max_trades_per_day ?? 5),
          max_daily_loss: Number((settings as any)?.max_daily_loss ?? 3),
          max_weekly_loss: Number((settings as any)?.max_weekly_loss ?? 6),
        },
      });
    } else {
      result = runBacktest(candles, config);
    }
    const label =
      data.label?.trim() ||
      `${data.mode === "pipeline" ? "Pipeline" : "Classic"} · ${data.timeframe}m · ${data.period}`;

    let id: string | null = null;
    if (data.save) {
      const { data: row } = await context.supabase
        .from("backtest_runs")
        .insert({
          user_id: context.userId,
          label,
          symbol: "XAUUSD",
          timeframe: data.timeframe,
          bars: result.bars,
          config: { ...config, period: data.period, mode: data.mode } as any,
          metrics: result.metrics as any,
          equity_curve: result.equityCurve as any,
          // Keep the persisted payload small; the newest trades matter most.
          trades: result.trades.slice(-200) as any,
          started_at: new Date(startedAt).toISOString(),
          ended_at: new Date().toISOString(),
        })
        .select("id")
        .maybeSingle();
      id = row?.id ?? null;
    }

    return {
      ok: true as const,
      id,
      label,
      durationMs: Date.now() - startedAt,
      ...result,
    };
  });

export const listBacktestRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("backtest_runs")
      .select("id, label, timeframe, bars, metrics, equity_curve, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(20);
    return data ?? [];
  });

export const deleteBacktestRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await context.supabase.from("backtest_runs").delete().eq("id", data.id).eq("user_id", context.userId);
    return { ok: true as const };
  });
