// Replay adapter: turns a historical bar into the exact input shape the live
// decision pipeline consumes.
//
// FIDELITY CONTRACT — read this before trusting a pipeline backtest.
//
// Computed for real from history (identical to live):
//   market structure, multi-timeframe bias, session liquidity, volume,
//   volatility, momentum, candle quality, session statistics (over the
//   simulated trade history), the structured confidence engine, the composite
//   engine, the safety checklist, adaptive policy, risk sizing, laddering and
//   position management.
//
// Neutralised (no point-in-time archive exists):
//   * macro / news intelligence and market sentiment
//   * cross-market correlation (SMT)
//   Both are pinned to NEUTRAL_PILLAR_SCORE — the final-confidence gate value
//   itself — so they are exactly boundary-neutral: they can neither push a
//   marginal setup over the line nor block one that the measurable pillars
//   would otherwise pass. They do NOT represent a favourable macro backdrop.
//
// Trivially satisfied (infrastructure, not strategy):
//   feed connectivity, quote freshness and execution-engine connectivity.
//   A historical bar has no live feed, so these gates are stamped healthy.

import type { Candle } from "@/lib/indicators";
import type { MarketQuote } from "@/lib/market-data.types";
import type { CorrelationReport, QuantIntel, SessionReport } from "@/lib/services/quant.types";
import type { MacroReport } from "@/lib/services/macro.types";
import type { MultiTimeframeReport } from "@/lib/services/mtf";
import type { StructureRead } from "@/lib/services/structure";
import type { SessionLiquidityRead } from "@/lib/services/sessions-liquidity";
import type { Direction } from "@/lib/services/types";
import type { OrchestratorInput } from "@/lib/services/orchestrator";

import { analyseVolume } from "@/lib/services/volume";
import { analyseVolatility } from "@/lib/services/volatility";
import { analyseMomentum } from "@/lib/services/momentum";
import { analyseCandles } from "@/lib/services/candle-quality";
import { analyseSessions, sessionForDate } from "@/lib/services/session-stats";
import { CONFIDENCE_GATES } from "@/lib/services/scoring";
import type { ReplayProposal } from "./proposal";

/**
 * Score assigned to every pillar that cannot be reconstructed historically.
 * Set to the final-confidence gate so those pillars are neutral with respect
 * to the pass/fail boundary rather than arbitrarily helpful or harmful.
 */
export const NEUTRAL_PILLAR_SCORE = CONFIDENCE_GATES.FINAL;

export const FIDELITY_CAVEATS: string[] = [
  `Macro / news and sentiment pillars are neutralised at ${NEUTRAL_PILLAR_SCORE} — no point-in-time news archive exists, so fundamentals neither help nor block a setup.`,
  `Cross-market correlation (SMT) is neutralised at ${NEUTRAL_PILLAR_SCORE} in the composite and reported as unavailable to the structured confidence engine.`,
  "Economic-calendar blackouts and post-release waits are not applied; live trading blocks around high-impact releases and a replay cannot.",
  "Feed-health gates (connectivity, quote age, execution-engine connection) are stamped healthy — they measure infrastructure, not strategy.",
  "Fills are simulated on OHLC bars: entries fill at the decision bar's close plus cost, and when a bar touches both stop and target the stop is assumed first.",
  "Timeframes finer than the execution timeframe cannot be reconstructed from the source series and are reported as missing to the multi-timeframe engine.",
];

/** Neutralised macro report. Direction-aware so the directional score lands on NEUTRAL_PILLAR_SCORE. */
export function buildReplayMacro(direction: Direction | null, now: number): MacroReport {
  const score = direction === "SELL" ? 100 - NEUTRAL_PILLAR_SCORE : NEUTRAL_PILLAR_SCORE;
  return {
    generated_at: now,
    news_score: score,
    gold_bias: "neutral",
    dollar_strength: "neutral",
    rate_outlook: "neutral",
    risk_environment: "mixed",
    yields: "flat",
    geopolitical_risk: "low",
    sentiment_score: score,
    summary: "Replay mode — macro intelligence neutralised (no point-in-time news archive).",
    bullish_drivers: [],
    bearish_drivers: [],
    headlines: [],
    upcoming_events: [],
    blackout: { active: false, reason: null, event: null, minutes_away: null },
    post_event_wait: false,
    degraded: false,
  };
}

/** Neutralised correlation report: honest about having no legs. */
export function buildReplayCorrelation(): CorrelationReport {
  return {
    score: NEUTRAL_PILLAR_SCORE,
    notes: ["Correlation neutralised in replay — no point-in-time DXY/yields series"],
    degraded: true,
    legs: [],
    supporting: 0,
    conflicting: 0,
  };
}

/** Quantitative intelligence measured from the point-in-time candle window. */
export function buildReplayQuant(i: {
  candles: Candle[];
  timeframe: string;
  direction: Direction | null;
  now: number;
}): QuantIntel {
  const volume = analyseVolume(i.candles, i.direction);
  const volatility = analyseVolatility(i.candles);
  const momentum = analyseMomentum(i.candles, i.direction);
  const candles = analyseCandles(i.candles, i.direction);
  return {
    generated_at: i.now,
    timeframe: i.timeframe,
    price: i.candles.length ? i.candles[i.candles.length - 1].c : null,
    volume,
    volatility,
    momentum,
    candles,
    correlation: buildReplayCorrelation(),
    degraded: false,
  };
}

/** Synthetic quote. Timestamp is "now" so freshness gates measure nothing. */
export function buildReplayQuote(price: number, spread: number): MarketQuote {
  return {
    symbol: "XAUUSD",
    bid: Number((price - spread / 2).toFixed(2)),
    ask: Number((price + spread / 2).toFixed(2)),
    mid: Number(price.toFixed(2)),
    spread: Number(spread.toFixed(2)),
    timestamp: Date.now(),
    source: "replay",
  };
}

export interface ReplaySettings {
  risk_per_trade: number;
  max_open_trades: number;
  max_trades_per_day: number;
  max_daily_loss: number;
  max_weekly_loss: number;
  max_drawdown_pct: number;
  min_risk_reward: number;
  max_spread: number;
  confidence_threshold: number;
  auto_execute: boolean;
  avoid_news: boolean;
  preferred_session: string | null;
}

export function buildReplaySettings(overrides: Partial<ReplaySettings> = {}): ReplaySettings {
  return {
    risk_per_trade: 0.5,
    max_open_trades: 3,
    max_trades_per_day: 5,
    max_daily_loss: 3,
    max_weekly_loss: 6,
    max_drawdown_pct: 10,
    min_risk_reward: 2,
    max_spread: 0.5,
    confidence_threshold: CONFIDENCE_GATES.FINAL,
    auto_execute: true,
    avoid_news: false,
    preferred_session: null,
    ...overrides,
  };
}

export interface ReplayBarContext {
  bar: Candle;
  timeframe: string;
  structure: StructureRead;
  mtf: MultiTimeframeReport | null;
  liquidity: SessionLiquidityRead | null;
  executionCandles: Candle[];
  proposal: ReplayProposal | null;
  /** Simulated trade rows in the same shape the database returns. */
  tradeRows: any[];
  balance: number;
  dailyPnl: number;
  weeklyPnl: number;
  settings: ReplaySettings;
  spread: number;
  cycleId: string;
}

/** Analysis object standing in for the AI response. */
export function buildReplayAnalysis(ctx: ReplayBarContext) {
  const p = ctx.proposal;
  const session = sessionForDate(new Date(ctx.bar.t));
  const bias =
    ctx.structure.bias !== "neutral"
      ? ctx.structure.bias
      : ctx.mtf
        ? ctx.mtf.score > 0
          ? "bullish"
          : ctx.mtf.score < 0
            ? "bearish"
            : "neutral"
        : "neutral";

  return {
    setup: p
      ? {
          direction: p.direction,
          entry: p.entry,
          stop_loss: p.stop_loss,
          take_profit_1: p.take_profit_1,
          take_profit_2: p.take_profit_2,
          take_profit_3: p.take_profit_3,
          risk_reward: p.risk_reward,
        }
      : null,
    bias,
    session_context: session,
    news_risk: "low",
    explanation: p ? `Replay · ${p.model} · ${p.origin}` : "No structure-derived setup",
    source: "replay-structure",
  };
}

export function buildOrchestratorInput(ctx: ReplayBarContext): OrchestratorInput {
  const analysis = buildReplayAnalysis(ctx);
  const direction: Direction | null = ctx.proposal?.direction ?? null;
  const now = ctx.bar.t;
  const session = sessionForDate(new Date(now));
  const quant = buildReplayQuant({
    candles: ctx.executionCandles,
    timeframe: ctx.timeframe,
    direction,
    now,
  });
  const sessionReport: SessionReport = analyseSessions(ctx.tradeRows, session);
  const sweep = ctx.liquidity?.sweeps?.[0] ?? null;

  return {
    timeframe: ctx.timeframe,
    session,
    analysis,
    confluence: null,
    macro: buildReplayMacro(direction, now),
    quant,
    sessionReport,
    management: null,
    quote: buildReplayQuote(ctx.bar.c, ctx.spread),
    connection: "connected",
    settings: ctx.settings,
    snapshot: {
      account: { balance: ctx.balance, equity: ctx.balance },
      daily_pnl: ctx.dailyPnl,
      weekly_pnl: ctx.weeklyPnl,
    },
    trades: ctx.tradeRows,
    killSwitch: { active: false, reason: null, since: null },
    running: true,
    execConnected: true,
    tradingMode: "paper",
    challenge: { enforced: false, status: null, profile: null },
    calibration: null,
    environmentTrackRecord: null,
    cycleId: ctx.cycleId,
    mtf: ctx.mtf,
    entryStructure: ctx.structure,
    confidenceWeights: null,
    sessionSweep: sweep ? { side: sweep.side, reclaimed: sweep.reclaimed, t: sweep.t } : null,
    now,
  };
}
