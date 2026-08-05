// The decision pipeline, extracted from the React hook so exactly one
// implementation exists.
//
//   analyse → confluence → composite → adaptive → challenge → safety →
//   plans (or rejection) → position management
//
// Everything here is pure: given the same inputs it produces the same
// decision, whether it runs in the browser (useAutopilot) or on the server
// (the scheduled tick). No I/O, no React, no clock-dependent behaviour
// beyond `Date.now()` for day boundaries.

import type { MarketQuote, ConnectionStatus } from "@/lib/market-data.types";
import type { ChallengeStatus } from "@/lib/challenge/engine";
import type { CalibrationReport } from "./calibration";
import type { CompositeConfidence, MacroReport } from "./macro.types";
import type { ManagementRecommendation, QuantIntel, SessionReport } from "./quant.types";
import type { ConfluenceReport, KillSwitchState, SafetyReport, TradePlan } from "./types";

import { buildAdaptivePolicy, type AdaptivePolicy } from "./adaptive";
import { classifyEnvironment, environmentKey, type EnvironmentReading } from "./environment";
import { buildLadderPlans, MAX_RISK_PER_LEG_PCT } from "./execution";
import { evaluate as evaluatePosition, type ManagementAction, type OpenTrade } from "./position-manager";
import { runSafety, SAFETY_CONSTANTS } from "./safety";
import { computeComposite, sizeMultiplier } from "./scoring";

/* ------------------------------------------------------------------ */
/* Account state derived from stored trades                            */
/* ------------------------------------------------------------------ */

export interface AccountState {
  openTrades: OpenTrade[];
  consecutiveLosses: number;
  todayTradeCount: number;
  drawdownPct: number;
  recentPnl: number[];
}

export function deriveAccountState(tradeRows: any[], snapshot: any | null): AccountState {
  const rows = Array.isArray(tradeRows) ? tradeRows : [];

  const closedDesc = rows
    .filter((t: any) => t.status === "closed" && t.pnl != null)
    .sort((a: any, b: any) => new Date(b.closed_at).getTime() - new Date(a.closed_at).getTime());

  let consecutiveLosses = 0;
  for (const t of closedDesc) {
    if (Number(t.pnl) < 0) consecutiveLosses += 1;
    else break;
  }

  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  const todayTradeCount = rows.filter((t: any) => new Date(t.opened_at) >= day).length;

  const openTrades: OpenTrade[] = rows
    .filter((t: any) => t.status === "open")
    .map((t: any) => ({
      id: t.id,
      direction: t.direction,
      entry_price: Number(t.entry_price),
      stop_loss: Number(t.stop_loss),
      take_profit_1: t.take_profit_1 != null ? Number(t.take_profit_1) : null,
      take_profit_2: t.take_profit_2 != null ? Number(t.take_profit_2) : null,
      take_profit_3: t.take_profit_3 != null ? Number(t.take_profit_3) : null,
      lot_size: Number(t.lot_size),
      opened_at: t.opened_at,
    }));

  // Peak-to-trough drawdown over the realised equity curve.
  const closedAsc = [...closedDesc].reverse();
  const start =
    Number(snapshot?.account?.balance ?? 10000) -
    closedAsc.reduce((a: number, t: any) => a + Number(t.pnl), 0);
  let eq = start;
  let peak = start;
  let worst = 0;
  for (const t of closedAsc) {
    eq += Number(t.pnl);
    peak = Math.max(peak, eq);
    worst = Math.max(worst, peak > 0 ? ((peak - eq) / peak) * 100 : 0);
  }

  return {
    openTrades,
    consecutiveLosses,
    todayTradeCount,
    drawdownPct: Number(worst.toFixed(2)),
    recentPnl: closedDesc.slice(0, 10).map((t: any) => Number(t.pnl)),
  };
}

/* ------------------------------------------------------------------ */
/* Risk-condition score feeding the composite engine                   */
/* ------------------------------------------------------------------ */

export function computeRiskScore(i: {
  settings: any | null;
  snapshot: any | null;
  openCount: number;
  consecutiveLosses: number;
  quote: MarketQuote | null;
  connection: ConnectionStatus;
}): number {
  const s: any = i.settings ?? {};
  const bal = Number(i.snapshot?.account?.balance ?? 1) || 1;
  const dailyLossPct = (-Math.min(0, Number(i.snapshot?.daily_pnl ?? 0)) / bal) * 100;
  const maxDaily = Number(s.max_daily_loss ?? 3) || 3;
  const maxOpen = Number(s.max_open_trades ?? 3) || 3;
  let score = 100;
  score -= Math.min(40, (dailyLossPct / maxDaily) * 40);
  score -= Math.min(20, (i.openCount / maxOpen) * 20);
  score -= i.consecutiveLosses * 10;
  if ((i.quote?.spread ?? 0) > 0.4) score -= 10;
  if (i.connection !== "connected") score -= 30;
  return Math.max(0, Math.round(score));
}

/* ------------------------------------------------------------------ */
/* Kill switch                                                         */
/* ------------------------------------------------------------------ */

/**
 * The same three automatic trips the client engine has always applied.
 * Returns the reason to trip, or null. Callers persist the trip.
 */
export function evaluateKillSwitch(i: {
  running: boolean;
  killSwitch: KillSwitchState;
  consecutiveLosses: number;
  settings: any | null;
  snapshot: any | null;
  connection: ConnectionStatus;
}): string | null {
  if (i.killSwitch.active || !i.running) return null;
  if (i.consecutiveLosses >= 3) return "3 consecutive losses";

  if (i.snapshot) {
    const bal = Number(i.snapshot?.account?.balance ?? 1) || 1;
    const s: any = i.settings ?? {};
    const dailyLossPct = (-Math.min(0, Number(i.snapshot?.daily_pnl ?? 0)) / bal) * 100;
    const weeklyLossPct = (-Math.min(0, Number(i.snapshot?.weekly_pnl ?? 0)) / bal) * 100;
    if (dailyLossPct >= Number(s.max_daily_loss ?? 3)) return `Daily loss ${dailyLossPct.toFixed(2)}% reached`;
    if (weeklyLossPct >= Number(s.max_weekly_loss ?? 6)) return `Weekly loss ${weeklyLossPct.toFixed(2)}% reached`;
  }

  if (i.connection === "disconnected") return "Live price feed disconnected";
  return null;
}

/* ------------------------------------------------------------------ */
/* Full pipeline                                                       */
/* ------------------------------------------------------------------ */

export interface OrchestratorInput {
  timeframe: string;
  session: string;
  analysis: any | null;
  confluence: ConfluenceReport | null;
  macro: MacroReport | null;
  quant: QuantIntel | null;
  sessionReport: SessionReport | null;
  management: ManagementRecommendation | null;
  quote: MarketQuote | null;
  connection: ConnectionStatus;
  settings: any | null;
  snapshot: any | null;
  trades: any[];
  killSwitch: KillSwitchState;
  running: boolean;
  execConnected: boolean;
  tradingMode: "paper" | "live";
  challenge: { enforced: boolean; status: ChallengeStatus | null; profile: any | null };
  calibration: CalibrationReport | null;
  /** Historical win rate in the environment classified this cycle. */
  environmentTrackRecord?: { winRate: number; trades: number } | null;
  /** Idempotency root for this decision cycle. */
  cycleId: string;
}

export type OrchestratorAction = "open" | "reject" | "halt";

export interface OrchestratorDecision {
  account: AccountState;
  riskScore: number;
  environment: EnvironmentReading;
  environmentKey: string | null;
  adaptive: AdaptivePolicy;
  composite: CompositeConfidence | null;
  safety: SafetyReport;
  action: OrchestratorAction;
  /** Ladder legs to submit when action === "open". */
  plans: TradePlan[];
  riskPctPerLeg: number;
  /** Human-readable reason nothing was submitted. */
  rejection: string | null;
  killSwitchTrip: string | null;
  /** Deduplication key for the current setup snapshot. */
  setupKey: string | null;
}

export function runDecisionPipeline(i: OrchestratorInput): OrchestratorDecision {
  const account = deriveAccountState(i.trades, i.snapshot);
  const s: any = i.settings ?? {};

  const environment = classifyEnvironment(i.quant, i.macro);

  const riskScore = computeRiskScore({
    settings: i.settings,
    snapshot: i.snapshot,
    openCount: account.openTrades.length,
    consecutiveLosses: account.consecutiveLosses,
    quote: i.quote,
    connection: i.connection,
  });

  const bal = Number(i.snapshot?.account?.balance ?? 1) || 1;
  const adaptive = buildAdaptivePolicy({
    drawdownPct: account.drawdownPct,
    maxDrawdownPct: Number(s.max_drawdown_pct ?? 10) || 10,
    dailyLossPct: (-Math.min(0, Number(i.snapshot?.daily_pnl ?? 0)) / bal) * 100,
    maxDailyLossPct: Number(s.max_daily_loss ?? 3) || 3,
    consecutiveLosses: account.consecutiveLosses,
    recentPnl: account.recentPnl,
    calibration: i.calibration,
    baseThreshold: SAFETY_CONSTANTS.MIN_CONFIDENCE,
    environmentTrackRecord: i.environmentTrackRecord ?? null,
  });

  const composite = computeComposite({
    confluence: i.confluence,
    analysis: i.analysis,
    macro: i.macro,
    riskScore,
    finalThreshold: adaptive.confidenceThreshold,
    volume: i.quant?.volume,
    volatility: i.quant?.volatility,
    momentum: i.quant?.momentum,
    candleQuality: i.quant?.candles,
    correlation: i.quant?.correlation,
    session: i.sessionReport ?? undefined,
  });

  const safety = runSafety({
    analysis: i.analysis,
    confluence: i.confluence,
    quote: i.quote,
    connection: i.connection,
    settings: i.settings,
    snapshot: i.snapshot,
    openTrades: account.openTrades,
    todayTradeCount: account.todayTradeCount,
    consecutiveLosses: account.consecutiveLosses,
    killSwitch: { active: i.killSwitch.active, reason: i.killSwitch.reason },
    autoExecuteEnabled: !!s.auto_execute,
    execConnected: i.execConnected,
    macro: i.macro,
    composite,
    challenge: { enforced: i.challenge.enforced, status: i.challenge.status },
  });

  const killSwitchTrip = evaluateKillSwitch({
    running: i.running,
    killSwitch: i.killSwitch,
    consecutiveLosses: account.consecutiveLosses,
    settings: i.settings,
    snapshot: i.snapshot,
    connection: i.connection,
  });

  const setup = i.analysis?.setup ?? null;
  const setupKey = setup
    ? `${setup.direction}:${setup.entry}:${setup.stop_loss}:${setup.take_profit_1}`
    : null;

  const base: OrchestratorDecision = {
    account,
    riskScore,
    environment,
    environmentKey: environmentKey(environment),
    adaptive,
    composite,
    safety,
    action: "reject",
    plans: [],
    riskPctPerLeg: 0,
    rejection: safety.ok ? null : safety.failingReasons[0] ?? null,
    killSwitchTrip,
    setupKey,
  };

  // ---- Gates before sizing ---------------------------------------------
  if (!i.running || i.killSwitch.active) return base;
  if (!safety.ok || !setup || !i.quote) return base;

  if (adaptive.halted) {
    return { ...base, action: "halt", rejection: adaptive.reasons[0] ?? "Capital preservation lockdown" };
  }

  // ---- Sizing -----------------------------------------------------------
  const balance = Number(i.snapshot?.account?.balance ?? 10000);
  const mult = composite
    ? sizeMultiplier(i.macro, composite, { volume: i.quant?.volume, volatility: i.quant?.volatility })
    : 1;
  const targets = [setup.take_profit_1, setup.take_profit_2, setup.take_profit_3]
    .filter((t: any) => t != null)
    .map((t: any) => Number(t));

  let riskPctPerLeg = Number(
    (
      Math.min(MAX_RISK_PER_LEG_PCT, Number(s.risk_per_trade ?? MAX_RISK_PER_LEG_PCT)) *
      mult *
      adaptive.sizeMultiplier
    ).toFixed(3),
  );

  if (i.challenge.enforced && i.challenge.status) {
    const legs = Math.max(1, targets.length);
    const challengeCapPerLeg = i.challenge.status.maxRiskPctForNextTrade / legs;
    riskPctPerLeg = Number(
      Math.min(riskPctPerLeg * i.challenge.status.sizeMultiplier, challengeCapPerLeg).toFixed(3),
    );
    if (riskPctPerLeg <= 0) {
      return {
        ...base,
        action: "halt",
        rejection: "Challenge budget exhausted — no risk remains inside the account's safety buffer",
      };
    }
  }

  const cs = i.challenge.status;
  const planBase = {
    direction: setup.direction,
    entry: Number(setup.entry),
    stop_loss: Number(setup.stop_loss),
    take_profit_2: null,
    take_profit_3: null,
    confidence: Number(composite?.final ?? i.confluence?.score ?? i.analysis?.confidence ?? 0),
    timeframe: i.timeframe,
    session: i.session,
    reason: i.analysis?.explanation ?? "Autopilot",
    environment: environmentKey(environment),

    ai_analysis: {
      ...i.analysis,
      macro: i.macro,
      composite,
      quant: i.quant,
      session_stats: i.sessionReport,
      management: i.management,
      environment,
      challenge:
        i.challenge.enforced && cs
          ? {
              profile_id: i.challenge.profile?.id ?? null,
              provider: i.challenge.profile?.provider ?? null,
              phase: i.challenge.profile?.phase ?? null,
              posture: cs.posture,
              pass_probability: cs.passProbability,
              health: cs.health,
              daily_used_pct: cs.daily.usedPct,
              drawdown_used_pct: cs.drawdown.usedPct,
            }
          : null,
    },
  };

  const plans = buildLadderPlans({
    base: planBase,
    targets,
    balance,
    riskPctPerLeg,
    cycleId: i.cycleId || (setupKey ?? "cycle"),
  });

  if (plans.length === 0) {
    return { ...base, riskPctPerLeg, rejection: "No valid take-profit target on the correct side of entry" };
  }

  // Respect the max-open-trades ceiling: only take as many legs as fit.
  const room = Math.max(0, Number(s.max_open_trades ?? 3) - account.openTrades.length);
  const toOpen = plans.slice(0, room);
  if (toOpen.length === 0) {
    return { ...base, riskPctPerLeg, rejection: "Maximum open positions already reached" };
  }

  return { ...base, action: "open", plans: toOpen, riskPctPerLeg, rejection: null };
}

/* ------------------------------------------------------------------ */
/* Position management                                                 */
/* ------------------------------------------------------------------ */

export interface PositionActionPlan {
  trade: OpenTrade;
  action: Exclude<ManagementAction, { type: "none" }>;
  dedupeKey: string;
}

/**
 * Break-even, trailing and target logic for every open position.
 * Applies uniformly regardless of how the trade was created — there is
 * deliberately no `source` filtering here, so manual trades are managed
 * exactly like autopilot trades.
 */
export function planPositionActions(i: {
  openTrades: OpenTrade[];
  price: number | null | undefined;
  atr?: number | null;
  management?: ManagementRecommendation | null;
}): PositionActionPlan[] {
  const price = i.price;
  if (!price || !Number.isFinite(price) || i.openTrades.length === 0) return [];
  const out: PositionActionPlan[] = [];
  for (const trade of i.openTrades) {
    const action = evaluatePosition({
      trade,
      price,
      atr: i.atr ?? null,
      plan: i.management ?? null,
    });
    if (action.type === "none") continue;
    out.push({
      trade,
      action,
      dedupeKey: `${trade.id}:${action.type}:${"new_stop" in action ? action.new_stop : "close"}`,
    });
  }
  return out;
}
