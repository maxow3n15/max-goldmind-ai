// Advanced Risk Engine.
//
// One deterministic authority over "may we trade, and how big?". It is pure:
// no network, no React, no clock reads beyond the `now` passed in — which
// makes it reusable by the live engine AND the backtester.
//
// Layers, in order of severity:
//   1. Hard violations  → trading blocked outright.
//   2. Warnings         → allowed, but size is reduced.
//   3. Sizing           → volatility-normalised lot size, capped by every
//                         exposure limit that applies.

import type { Direction } from "./types";

export interface RiskLimits {
  riskPerTradePct: number;
  maxRiskPerTradePct: number;
  maxDailyLossPct: number;
  maxWeeklyLossPct: number;
  maxDrawdownPct: number;
  maxOpenTrades: number;
  maxTradesPerDay: number;
  maxTotalExposureLots: number;
  maxCorrelatedTrades: number;
  cooldownMinutes: number;
  recoveryModeEnabled: boolean;
}

export interface RiskPosition {
  id: string;
  direction: Direction;
  lot_size: number;
  entry_price: number;
  stop_loss: number;
}

export interface RiskInput {
  now: number;
  limits: RiskLimits;
  balance: number;
  equity: number;
  /** Highest equity ever reached — drives the drawdown calculation. */
  peakEquity: number;
  dailyPnl: number;
  weeklyPnl: number;
  openPositions: RiskPosition[];
  tradesToday: number;
  consecutiveLosses: number;
  /** Epoch ms of the most recent losing close, if any. */
  lastLossAt: number | null;
  spread: number | null;
  /** ATR of the trading timeframe in price units, for volatility sizing. */
  atr: number | null;
  feedHealthy: boolean;
  /** Proposed trade, when sizing is requested. */
  proposal?: { direction: Direction; entry: number; stop_loss: number } | null;
}

export interface RiskViolation {
  key: string;
  label: string;
  detail: string;
  severity: "block" | "warn";
}

export interface RiskAssessment {
  /** 0..100 — higher is healthier. Feeds the composite confidence engine. */
  score: number;
  level: "normal" | "cautious" | "defensive" | "locked";
  allowed: boolean;
  violations: RiskViolation[];
  warnings: RiskViolation[];
  /** Multiplier applied to the base risk percentage (0.25 .. 1). */
  sizeMultiplier: number;
  /** Final risk budget for the next trade, as a % of balance. */
  effectiveRiskPct: number;
  /** Volatility-normalised lot size for the proposal, when one is supplied. */
  lotSize: number | null;
  exposureLots: number;
  drawdownPct: number;
  dailyLossPct: number;
  weeklyLossPct: number;
  cooldownUntil: number | null;
  recoveryMode: boolean;
  notes: string[];
}

/** XAUUSD: 1.00 lot = 100 oz, so $1 of price move = $100 per lot. */
export const GOLD_CONTRACT_SIZE = 100;

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  riskPerTradePct: 0.5,
  maxRiskPerTradePct: 0.5,
  maxDailyLossPct: 3,
  maxWeeklyLossPct: 6,
  maxDrawdownPct: 10,
  maxOpenTrades: 3,
  maxTradesPerDay: 5,
  maxTotalExposureLots: 1,
  maxCorrelatedTrades: 2,
  cooldownMinutes: 15,
  recoveryModeEnabled: true,
};

/** Build limits from a raw user_settings row, falling back to safe defaults. */
export function limitsFromSettings(s: any | null | undefined): RiskLimits {
  const n = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const base = DEFAULT_RISK_LIMITS;
  return {
    riskPerTradePct: Math.min(n(s?.risk_per_trade, base.riskPerTradePct), n(s?.max_risk_per_trade_pct, base.maxRiskPerTradePct)),
    maxRiskPerTradePct: n(s?.max_risk_per_trade_pct, base.maxRiskPerTradePct),
    maxDailyLossPct: n(s?.max_daily_loss, base.maxDailyLossPct),
    maxWeeklyLossPct: n(s?.max_weekly_loss, base.maxWeeklyLossPct),
    maxDrawdownPct: n(s?.max_drawdown_pct, base.maxDrawdownPct),
    maxOpenTrades: n(s?.max_open_trades, base.maxOpenTrades),
    maxTradesPerDay: n(s?.max_trades_per_day, base.maxTradesPerDay),
    maxTotalExposureLots: n(s?.max_total_exposure_lots, base.maxTotalExposureLots),
    maxCorrelatedTrades: n(s?.max_correlated_trades, base.maxCorrelatedTrades),
    cooldownMinutes: n(s?.cooldown_minutes, base.cooldownMinutes),
    recoveryModeEnabled: s?.recovery_mode_enabled !== false,
  };
}

export function assessRisk(input: RiskInput): RiskAssessment {
  const { limits: L, now } = input;
  const violations: RiskViolation[] = [];
  const warnings: RiskViolation[] = [];
  const notes: string[] = [];

  const balance = input.balance > 0 ? input.balance : 1;
  const peak = Math.max(input.peakEquity || 0, input.equity || 0, balance);

  const dailyLossPct = (-Math.min(0, input.dailyPnl) / balance) * 100;
  const weeklyLossPct = (-Math.min(0, input.weeklyPnl) / balance) * 100;
  const drawdownPct = peak > 0 ? Math.max(0, ((peak - input.equity) / peak) * 100) : 0;
  const exposureLots = input.openPositions.reduce((a, p) => a + (Number(p.lot_size) || 0), 0);

  const block = (key: string, label: string, detail: string) =>
    violations.push({ key, label, detail, severity: "block" });
  const warn = (key: string, label: string, detail: string) =>
    warnings.push({ key, label, detail, severity: "warn" });

  // ---- Layer 1: hard limits -------------------------------------------
  if (dailyLossPct >= L.maxDailyLossPct)
    block("daily_loss", "Daily loss limit reached", `${dailyLossPct.toFixed(2)}% of ${L.maxDailyLossPct}%`);
  if (weeklyLossPct >= L.maxWeeklyLossPct)
    block("weekly_loss", "Weekly loss limit reached", `${weeklyLossPct.toFixed(2)}% of ${L.maxWeeklyLossPct}%`);
  if (drawdownPct >= L.maxDrawdownPct)
    block("drawdown", "Maximum drawdown reached", `${drawdownPct.toFixed(2)}% of ${L.maxDrawdownPct}%`);
  if (input.openPositions.length >= L.maxOpenTrades)
    block("max_open", "Open position limit reached", `${input.openPositions.length}/${L.maxOpenTrades}`);
  if (input.tradesToday >= L.maxTradesPerDay)
    block("max_daily_trades", "Daily trade count reached", `${input.tradesToday}/${L.maxTradesPerDay}`);
  if (exposureLots >= L.maxTotalExposureLots)
    block("exposure", "Total exposure limit reached", `${exposureLots.toFixed(2)}/${L.maxTotalExposureLots} lots`);
  if (input.consecutiveLosses >= 3)
    block("loss_streak", "Three consecutive losses", `${input.consecutiveLosses} in a row`);
  if (!input.feedHealthy)
    block("feed", "Price feed unhealthy", "risk cannot be measured without live prices");

  // Same-direction crowding: correlated exposure on a single instrument.
  if (input.proposal) {
    const sameDir = input.openPositions.filter((p) => p.direction === input.proposal!.direction).length;
    if (sameDir >= L.maxCorrelatedTrades)
      block("correlated", "Correlated position limit", `${sameDir} open ${input.proposal.direction} positions`);
  }

  // Cooldown after a loss — stops revenge trading.
  const cooldownUntil = input.lastLossAt != null ? input.lastLossAt + L.cooldownMinutes * 60_000 : null;
  if (cooldownUntil != null && now < cooldownUntil) {
    const mins = Math.ceil((cooldownUntil - now) / 60_000);
    block("cooldown", "Post-loss cooldown active", `${mins} min remaining`);
  }

  // ---- Layer 2: warnings that shrink size ------------------------------
  if (dailyLossPct >= L.maxDailyLossPct * 0.6)
    warn("daily_loss_near", "Approaching daily loss limit", `${dailyLossPct.toFixed(2)}%`);
  if (drawdownPct >= L.maxDrawdownPct * 0.5)
    warn("drawdown_near", "Drawdown above half the limit", `${drawdownPct.toFixed(2)}%`);
  if (input.consecutiveLosses > 0)
    warn("streak", "Recent losing trades", `${input.consecutiveLosses} consecutive`);
  if (input.spread != null && input.spread > 0.4)
    warn("spread", "Spread wider than normal", input.spread.toFixed(2));
  if (exposureLots > L.maxTotalExposureLots * 0.6)
    warn("exposure_near", "Exposure above 60% of limit", `${exposureLots.toFixed(2)} lots`);

  // ---- Layer 3: sizing --------------------------------------------------
  const recoveryMode =
    L.recoveryModeEnabled && (input.consecutiveLosses >= 2 || drawdownPct >= L.maxDrawdownPct * 0.5);

  let mult = 1;
  if (recoveryMode) { mult *= 0.5; notes.push("Recovery mode: position size halved until form recovers"); }
  if (input.consecutiveLosses === 1) mult *= 0.85;
  if (dailyLossPct >= L.maxDailyLossPct * 0.6) mult *= 0.7;
  if (drawdownPct >= L.maxDrawdownPct * 0.5) mult *= 0.7;
  if (input.spread != null && input.spread > 0.4) mult *= 0.85;
  // Scale down when the remaining daily loss budget is thinner than one full stop-out.
  const remainingDailyPct = Math.max(0, L.maxDailyLossPct - dailyLossPct);
  if (remainingDailyPct < L.riskPerTradePct * 2) {
    mult *= Math.max(0.25, remainingDailyPct / (L.riskPerTradePct * 2));
    notes.push("Daily loss budget nearly spent — risk scaled to what remains");
  }
  mult = Math.max(0.25, Math.min(1, Number(mult.toFixed(3))));

  const effectiveRiskPct = Number(
    Math.min(L.riskPerTradePct, L.maxRiskPerTradePct, remainingDailyPct || L.riskPerTradePct) * mult,
  );

  let lotSize: number | null = null;
  if (input.proposal) {
    const stopDistance = Math.abs(input.proposal.entry - input.proposal.stop_loss);
    if (stopDistance > 0) {
      const riskAmount = (balance * effectiveRiskPct) / 100;
      const raw = riskAmount / (stopDistance * GOLD_CONTRACT_SIZE);
      // Never let one trade breach the remaining exposure headroom.
      const headroom = Math.max(0, L.maxTotalExposureLots - exposureLots);
      lotSize = Math.max(0.01, Math.min(Number(raw.toFixed(2)), Number(headroom.toFixed(2)) || 0.01));
      if (input.atr && input.atr > 0) {
        // Flag stops that are unusually tight relative to current volatility.
        if (stopDistance < input.atr * 0.5) {
          warn("tight_stop", "Stop is tight for current volatility", `${stopDistance.toFixed(2)} vs ATR ${input.atr.toFixed(2)}`);
        }
      }
    }
  }

  // ---- Health score -----------------------------------------------------
  let score = 100;
  score -= Math.min(35, (dailyLossPct / Math.max(L.maxDailyLossPct, 0.1)) * 35);
  score -= Math.min(25, (drawdownPct / Math.max(L.maxDrawdownPct, 0.1)) * 25);
  score -= Math.min(15, (exposureLots / Math.max(L.maxTotalExposureLots, 0.01)) * 15);
  score -= Math.min(15, input.consecutiveLosses * 7);
  if (!input.feedHealthy) score -= 30;
  if (input.spread != null && input.spread > 0.4) score -= 5;
  score = Math.max(0, Math.round(score));

  const allowed = violations.length === 0;
  const level: RiskAssessment["level"] =
    !allowed ? "locked" : recoveryMode ? "defensive" : warnings.length > 0 ? "cautious" : "normal";

  return {
    score, level, allowed, violations, warnings,
    sizeMultiplier: mult,
    effectiveRiskPct: Number(effectiveRiskPct.toFixed(3)),
    lotSize,
    exposureLots: Number(exposureLots.toFixed(2)),
    drawdownPct: Number(drawdownPct.toFixed(2)),
    dailyLossPct: Number(dailyLossPct.toFixed(2)),
    weeklyLossPct: Number(weeklyLossPct.toFixed(2)),
    cooldownUntil,
    recoveryMode,
    notes,
  };
}
