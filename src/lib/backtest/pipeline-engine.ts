// Pipeline replay engine.
//
// Unlike the classic engine, this one does NOT contain a strategy. It walks
// history bar by bar, rebuilds the point-in-time market view, asks the real
// `runDecisionPipeline` what to do, and simulates the fills. Every gate the
// live system applies — structured confidence, composite, safety checklist,
// setup-model classification, adaptive policy, ladder sizing, break-even and
// trailing management — runs here unmodified.
//
// Deterministic: same candles + same config ⇒ identical trades and equity
// curve. Nothing here reads the wall clock for a decision (see
// `pipeline-adapter.ts` for the two deliberate exceptions, which are
// infrastructure gates, not strategy).

import { atrSeries, type Candle } from "@/lib/indicators";
import { GOLD_CONTRACT_SIZE } from "@/lib/services/risk-engine";
import { readStructure } from "@/lib/services/structure";
import { buildMultiTimeframeReport, type TimeframeKey } from "@/lib/services/mtf";
import { readSessionLiquidity } from "@/lib/services/sessions-liquidity";
import { sessionForDate } from "@/lib/services/session-stats";
import { planPositionActions, runDecisionPipeline } from "@/lib/services/orchestrator";
import type { OpenTrade } from "@/lib/services/position-manager";
import type { Direction } from "@/lib/services/types";

import { PointInTimeSeries } from "./replay-data";
import { proposeFromStructure, type ReplayProposal } from "./proposal";
import { ReplayCorrelation } from "./replay-correlation";
import {
  buildOrchestratorInput,
  buildReplaySettings,
  FIDELITY_CAVEATS,
  type ReplaySettings,
} from "./pipeline-adapter";
import {
  computeMetrics,
  downsample,
  type BacktestResult,
  type EquityPoint,
  type SimTrade,
} from "./engine";

export interface PipelineBacktestConfig {
  startingBalance: number;
  /** Execution timeframe of the supplied candles. */
  timeframe: TimeframeKey;
  /** Round-trip cost in price units (commission + slippage). */
  costPerTrade: number;
  /** Quoted spread used for the synthetic quote and the entry fill. */
  spread: number;
  /** Optional per-bar spread series (broker bid/ask), index-aligned with candles. */
  spreads?: number[];
  /**
   * Independently fetched historical series for timeframes finer than the
   * execution resolution. Without these the MTF report is always degraded.
   */
  finerSeries?: Partial<Record<TimeframeKey, Candle[]>>;
  /** Optional point-in-time correlation built from real historical series. */
  correlation?: ReplayCorrelation | null;
  /** Extra fidelity notes describing the data source actually used. */
  caveats?: string[];
  /** Bars a position may stay open before it is force-closed. */
  maxHoldBars: number;
  /** Bars consumed before the first decision, so structure is populated. */
  warmupBars: number;
  settings: Partial<ReplaySettings>;
  /** Structured-confidence factor weights under test (calibration). */
  confidenceWeights?: Record<string, number> | null;
  /** Composite pillar weights under test (calibration). */
  compositeWeights?: Record<string, number> | null;
  /** Exit parameters under test. */
  exits?: { breakEvenAtR?: number; trailAtrMultiple?: number } | null;
  /**
   * RESEARCH ONLY. Measurement floor for the confidence gate. Omit for a
   * faithful replay at the live 88% floor; the calibration harness lowers it
   * to observe the population of setups the gate rejects. It changes nothing
   * in live trading.
   */
  researchConfidenceFloor?: number | null;
}

export interface ModelStats {
  model: string;
  trades: number;
  wins: number;
  winRate: number;
  expectancyR: number;
  netPnl: number;
  /** False when fewer than 30 closed trades — not statistically meaningful. */
  sufficientSample: boolean;
}

export const MIN_MEANINGFUL_SAMPLE = 30;

export function summariseByModel(trades: SimTrade[]): ModelStats[] {
  const buckets = new Map<string, SimTrade[]>();
  for (const t of trades) {
    const k = t.model ?? "UNKNOWN";
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(t);
  }
  return [...buckets.entries()]
    .map(([model, list]) => {
      const wins = list.filter((t) => t.pnl > 0).length;
      const netPnl = Number(list.reduce((a, t) => a + t.pnl, 0).toFixed(2));
      const expectancyR = list.length
        ? Number((list.reduce((a, t) => a + (t.rMultiple ?? 0), 0) / list.length).toFixed(3))
        : 0;
      return {
        model,
        trades: list.length,
        wins,
        winRate: list.length ? Number(((wins / list.length) * 100).toFixed(1)) : 0,
        expectancyR,
        netPnl,
        sufficientSample: list.length >= MIN_MEANINGFUL_SAMPLE,
      };
    })
    .sort((a, b) => b.trades - a.trades);
}

export const DEFAULT_PIPELINE_CONFIG: Omit<PipelineBacktestConfig, "timeframe"> = {
  startingBalance: 10_000,
  costPerTrade: 0.35,
  spread: 0.3,
  maxHoldBars: 96,
  warmupBars: 200,
  settings: {},
};

export interface PipelineBacktestResult extends BacktestResult {
  mode: "pipeline";
  /** Why the pipeline refused to trade, most frequent first. */
  rejections: { reason: string; count: number }[];
  /** Bars on which a structure-derived candidate existed at all. */
  candidateBars: number;
  /** Bars the pipeline approved. */
  approvedBars: number;
  /** Setup models actually traded. */
  models: { model: string; trades: number }[];
  /** Per-setup-model validity: win rate, expectancy and sample size. */
  modelStats: ModelStats[];
  caveats: string[];
  missingTimeframes: TimeframeKey[];
  /** Temporary data-fidelity diagnostics for the calibration study. */
  dataFidelity: {
    candidateBars: number;
    mtfDegradedBars: number;
    mtfDegradedFraction: number;
    availableTimeframeCounts: { available: number; bars: number }[];
    htfAlignmentVerdicts: { verdict: string; count: number }[];
  };
  /** Distribution of the deterministic confidence on candidate bars. */
  confidence: { samples: number; median: number; p90: number; max: number };
}

/**
 * Resolve one open leg against one bar. Pure, and the single place fill
 * pessimism is expressed: gaps fill at the open, and a bar that touches both
 * the stop and the target is assumed to have hit the stop first.
 */
export function resolveLegAgainstBar(
  leg: { direction: Direction; stop: number; target: number; movedToBe: boolean; openBar: number },
  bar: Candle,
  barIndex: number,
  maxHoldBars: number,
): { exit: number; reason: SimTrade["exitReason"] } | null {
  const isBuy = leg.direction === "BUY";
  if (isBuy ? bar.o <= leg.stop : bar.o >= leg.stop) {
    return { exit: bar.o, reason: leg.movedToBe ? "trail" : "stop" };
  }
  if (isBuy ? bar.l <= leg.stop : bar.h >= leg.stop) {
    return { exit: leg.stop, reason: leg.movedToBe ? "trail" : "stop" };
  }
  if (isBuy ? bar.h >= leg.target : bar.l <= leg.target) {
    return { exit: leg.target, reason: "target" };
  }
  if (barIndex - leg.openBar >= maxHoldBars) return { exit: bar.c, reason: "timeout" };
  return null;
}

/** Apply a management stop move, refusing anything that widens risk. */
export function applyStopMove(
  leg: { direction: Direction; stop: number; movedToBe: boolean },
  newStop: number,
): boolean {
  const improves = leg.direction === "BUY" ? newStop > leg.stop : newStop < leg.stop;
  if (!improves) return false;
  leg.stop = newStop;
  leg.movedToBe = true;
  return true;
}

/**
 * Rejection strings carry the measured value ("Confidence >= 88% (61%)"), which
 * would otherwise produce one bucket per bar. Strip the value so the summary
 * groups by cause.
 */
export function normaliseRejection(reason: string): string {
  return reason
    .replace(/\s*\([^()]*\d[^()]*\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function summariseConfidence(values: number[]) {
  if (!values.length) return { samples: 0, median: 0, p90: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    samples: sorted.length,
    median: Math.round(at(0.5)),
    p90: Math.round(at(0.9)),
    max: Math.round(sorted[sorted.length - 1]),
  };
}

interface LiveLeg extends SimTrade {
  id: string;
  legIndex: number;
  openBar: number;
  /** Stop as originally placed — the denominator for R multiples. */
  initialStop: number;
  movedToBe: boolean;
  session: string;
}

function weekKey(t: number): string {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * 86_400_000;
  return String(monday);
}

function toTradeRow(leg: LiveLeg, status: "open" | "closed") {
  return {
    id: leg.id,
    status,
    direction: leg.direction,
    entry_price: leg.entry,
    stop_loss: leg.stop,
    initial_stop_loss: leg.initialStop,
    take_profit_1: leg.target,
    take_profit_2: null,
    take_profit_3: null,
    lot_size: leg.lots,
    opened_at: new Date(leg.openedAt).toISOString(),
    closed_at: status === "closed" ? new Date(leg.closedAt).toISOString() : null,
    pnl: status === "closed" ? leg.pnl : null,
    session: leg.session,
    source: "auto",
  };
}

function asOpenTrade(leg: LiveLeg): OpenTrade {
  return {
    id: leg.id,
    direction: leg.direction as Direction,
    entry_price: leg.entry,
    stop_loss: leg.stop,
    initial_stop_loss: leg.initialStop,
    take_profit_1: leg.target,
    take_profit_2: null,
    take_profit_3: null,
    lot_size: leg.lots,
    opened_at: new Date(leg.openedAt).toISOString(),
  };
}

export function runPipelineBacktest(
  candles: Candle[],
  config: PipelineBacktestConfig,
): PipelineBacktestResult {
  const cfg = config;
  const settings = buildReplaySettings(cfg.settings);
  const series = new PointInTimeSeries(candles, cfg.timeframe, undefined, cfg.finerSeries);
  // Exit parameters under test are expressed through the same management
  // recommendation object the live volatility engine produces.
  const managementPlan =
    cfg.exits && (cfg.exits.breakEvenAtR != null || cfg.exits.trailAtrMultiple != null)
      ? {
          break_even_at_r: cfg.exits.breakEvenAtR ?? 0.5,
          partial_at_r: 1,
          partial_fraction: 0.5,
          trail_atr_multiple: cfg.exits.trailAtrMultiple ?? 1.5,
          suggested_stop_distance: null,
          hold_winner: false,
          early_exit: false,
          notes: [],
        }
      : null;
  const atr = atrSeries(candles, 14);

  let balance = cfg.startingBalance;
  let peak = cfg.startingBalance;
  let maxDd = 0;
  let maxDdPct = 0;
  let dailyPnl = 0;
  let weeklyPnl = 0;
  let currentDay = "";
  let currentWeek = "";

  const closed: LiveLeg[] = [];
  let open: LiveLeg[] = [];
  const equityCurve: EquityPoint[] = [];
  const rejections = new Map<string, number>();
  const confidenceSamples: number[] = [];
  const models = new Map<string, number>();
  let candidateBars = 0;
  let approvedBars = 0;
  // Data-fidelity diagnostics: how often the replay's own market view is
  // degraded, and what that does to the HTF-alignment confidence factor.
  const diag = {
    candidateBars: 0,
    mtfDegradedBars: 0,
    availableTimeframeCounts: new Map<number, number>(),
    htfVerdicts: new Map<string, number>(),
  };
  let sequence = 0;

  const closeLeg = (leg: LiveLeg, exit: number, t: number, reason: SimTrade["exitReason"]) => {
    const dir = leg.direction === "BUY" ? 1 : -1;
    const gross = (exit - leg.entry) * dir * leg.lots * GOLD_CONTRACT_SIZE;
    const cost = cfg.costPerTrade * leg.lots * GOLD_CONTRACT_SIZE;
    const pnl = Number((gross - cost).toFixed(2));
    const riskAmount = Math.abs(leg.entry - leg.initialStop) * leg.lots * GOLD_CONTRACT_SIZE;
    leg.exit = Number(exit.toFixed(2));
    leg.closedAt = t;
    leg.pnl = pnl;
    leg.exitReason = reason;
    leg.rMultiple = riskAmount > 0 ? Number((pnl / riskAmount).toFixed(2)) : 0;
    balance += pnl;
    dailyPnl += pnl;
    weeklyPnl += pnl;
    closed.push(leg);
  };

  for (let i = 0; i < candles.length; i++) {
    const bar = series.advance();

    const dayKey = new Date(bar.t).toISOString().slice(0, 10);
    if (dayKey !== currentDay) {
      currentDay = dayKey;
      dailyPnl = 0;
    }
    const wk = weekKey(bar.t);
    if (wk !== currentWeek) {
      currentWeek = wk;
      weeklyPnl = 0;
    }

    /* ---- 1. resolve open positions against this bar ------------------ */
    const survivors: LiveLeg[] = [];
    for (const leg of open) {
      const resolved = resolveLegAgainstBar(leg, bar, i, cfg.maxHoldBars);
      if (resolved) {
        closeLeg(leg, resolved.exit, bar.t, resolved.reason);
        continue;
      }
      survivors.push(leg);
    }
    open = survivors;

    /* ---- 2. mark equity ---------------------------------------------- */
    peak = Math.max(peak, balance);
    const dd = peak - balance;
    if (dd > maxDd) {
      maxDd = dd;
      maxDdPct = (dd / peak) * 100;
    }
    equityCurve.push({
      t: bar.t,
      equity: Number(balance.toFixed(2)),
      drawdown: Number(((dd / peak) * 100).toFixed(2)),
    });

    if (i < cfg.warmupBars) continue;

    /* ---- 3. point-in-time market view -------------------------------- */
    const execution = series.execution();
    const structure = readStructure(execution);
    const mtf = buildMultiTimeframeReport(series.byTimeframe());
    const liquidity = readSessionLiquidity({
      intraday: execution,
      now: bar.t,
      daily: series.seriesFor("D"),
    });
    const barAtr = Number.isFinite(atr[i]) ? atr[i] : structure.atr;
    // Broker bid/ask history gives the spread this bar actually quoted; the
    // configured constant is only the fallback.
    const barSpread =
      cfg.spreads && Number.isFinite(cfg.spreads[i]) && cfg.spreads[i] > 0
        ? cfg.spreads[i]
        : cfg.spread;

    /* ---- 4. manage open positions on the close ------------------------ */
    const actions = planPositionActions({
      openTrades: open.map(asOpenTrade),
      price: bar.c,
      atr: barAtr,
      management: managementPlan,
    });
    for (const a of actions) {
      const leg = open.find((l) => l.id === a.trade.id);
      if (!leg) continue;
      if (a.action.type === "move_stop") {
        applyStopMove(leg, a.action.new_stop);
      } else if (a.action.type === "close") {
        closeLeg(leg, bar.c, bar.t, "trail");
        open = open.filter((l) => l.id !== leg.id);
      }
    }

    /* ---- 5. propose, then run the real decision pipeline -------------- */
    const proposal: ReplayProposal | null = proposeFromStructure({
      structure,
      mtf,
      liquidity,
      candles: execution,
      atr: barAtr,
      now: bar.t,
    });
    if (proposal) candidateBars += 1;

    const tradeRows = [
      ...closed.map((l) => toTradeRow(l, "closed")),
      ...open.map((l) => toTradeRow(l, "open")),
    ];

    const decision = runDecisionPipeline(
      buildOrchestratorInput({
        bar,
        timeframe: cfg.timeframe,
        structure,
        mtf,
        liquidity,
        executionCandles: execution,
        proposal,
        tradeRows,
        balance,
        dailyPnl,
        weeklyPnl,
        settings,
        spread: barSpread,
        correlation: cfg.correlation
          ? cfg.correlation.reportAt(bar.t, proposal?.direction ?? null)
          : null,
        cycleId: `replay-${i}`,
        confidenceWeights: cfg.confidenceWeights ?? null,
        compositeWeights: cfg.compositeWeights ?? null,
        researchConfidenceFloor: cfg.researchConfidenceFloor ?? null,
        // Loss-streak lockout is measured from the start of the current day —
        // live it latches until an operator clears it, which a replay cannot do.
        researchConsecutiveLosses: (() => {
          let n = 0;
          for (let k = closed.length - 1; k >= 0; k--) {
            const c = closed[k];
            if (new Date(c.closedAt).toISOString().slice(0, 10) !== dayKey) break;
            if (c.pnl < 0) n += 1;
            else break;
          }
          return n;
        })(),
      }),
    );

    if (proposal) {
      const c = decision.composite?.final ?? decision.structured?.score ?? null;
      if (typeof c === "number" && Number.isFinite(c)) confidenceSamples.push(c);

      diag.candidateBars += 1;
      if (mtf.degraded) diag.mtfDegradedBars += 1;
      const avail = mtf.timeframes.filter((t) => t.bars >= 12).length;
      diag.availableTimeframeCounts.set(avail, (diag.availableTimeframeCounts.get(avail) ?? 0) + 1);
      const htf = decision.structured?.factors?.find((f) => f.key === "htf_alignment");
      const v = htf?.verdict ?? "missing";
      diag.htfVerdicts.set(v, (diag.htfVerdicts.get(v) ?? 0) + 1);
    }

    if (decision.action !== "open" || decision.plans.length === 0) {
      if (proposal) {
        const reason = normaliseRejection(decision.rejection ?? decision.killSwitchTrip ?? "Pipeline declined");
        rejections.set(reason, (rejections.get(reason) ?? 0) + 1);
      }
      continue;
    }

    approvedBars += 1;
    const model = proposal?.model ?? "UNKNOWN";
    models.set(model, (models.get(model) ?? 0) + decision.plans.length);

    /* ---- 6. fill the ladder at the decision bar's close ---------------- */
    decision.plans.forEach((plan, legIndex) => {
      const isBuy = plan.direction === "BUY";
      const fill = Number((bar.c + (isBuy ? barSpread / 2 : -barSpread / 2)).toFixed(2));
      sequence += 1;
      open.push({
        id: `leg-${i}-${legIndex}-${sequence}`,
        legIndex,
        leg: legIndex + 1,
        openBar: i,
        index: i,
        openedAt: bar.t,
        closedAt: bar.t,
        direction: plan.direction,
        entry: fill,
        stop: plan.stop_loss,
        initialStop: plan.stop_loss,
        target: plan.take_profit_1,
        exit: fill,
        lots: plan.lot_size,
        pnl: 0,
        rMultiple: 0,
        confidence: plan.confidence,
        reason: plan.reason,
        exitReason: "timeout",
        movedToBe: false,
        model,
        session: sessionForDate(new Date(bar.t)),
      });
    });
  }

  const trades: SimTrade[] = closed
    .slice()
    .sort((a, b) => a.closedAt - b.closedAt || a.openedAt - b.openedAt)
    .map((l) => ({
      index: l.index,
      openedAt: l.openedAt,
      closedAt: l.closedAt,
      direction: l.direction,
      entry: l.entry,
      stop: l.stop,
      target: l.target,
      exit: l.exit,
      lots: l.lots,
      pnl: l.pnl,
      rMultiple: l.rMultiple,
      confidence: l.confidence,
      reason: l.reason,
      exitReason: l.exitReason,
      model: l.model ?? null,
      leg: l.leg,
    }));

  return {
    mode: "pipeline",
    metrics: computeMetrics(
      trades,
      equityCurve,
      cfg.startingBalance,
      balance,
      maxDd,
      maxDdPct,
      candidateBars - approvedBars,
    ),
    trades,
    equityCurve: downsample(equityCurve, 400),
    bars: candles.length,
    from: candles.length ? candles[0].t : null,
    to: candles.length ? candles[candles.length - 1].t : null,
    confidence: summariseConfidence(confidenceSamples),
    rejections: [...rejections.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12),
    candidateBars,
    approvedBars,
    modelStats: summariseByModel(trades),
    models: [...models.entries()].map(([model, count]) => ({ model, trades: count })).sort((a, b) => b.trades - a.trades),
    caveats: cfg.caveats ?? FIDELITY_CAVEATS,
    missingTimeframes: series.missingTimeframes(),
    dataFidelity: {
      candidateBars: diag.candidateBars,
      mtfDegradedBars: diag.mtfDegradedBars,
      mtfDegradedFraction: diag.candidateBars
        ? Number((diag.mtfDegradedBars / diag.candidateBars).toFixed(4))
        : 0,
      availableTimeframeCounts: [...diag.availableTimeframeCounts.entries()]
        .map(([available, bars]) => ({ available, bars }))
        .sort((a, b) => a.available - b.available),
      htfAlignmentVerdicts: [...diag.htfVerdicts.entries()]
        .map(([verdict, count]) => ({ verdict, count }))
        .sort((a, b) => b.count - a.count),
    },
  };
}
