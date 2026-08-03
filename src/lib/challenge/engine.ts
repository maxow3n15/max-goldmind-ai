// Challenge compliance engine.
//
// Pure, deterministic evaluation of a funded-account evaluation: how much
// of every limit has been consumed, whether the next trade is permitted,
// how large it may be, and how likely the account is to pass.
//
// It sits ALONGSIDE the existing risk engine rather than replacing it: the
// risk engine protects the strategy, this protects the account's eligibility.
// Whichever is stricter wins.

import type { DrawdownType } from "./presets";

export interface ChallengeRules {
  account_size: number;
  start_balance: number;
  profit_target_pct: number;
  daily_loss_limit_pct: number;
  max_drawdown_pct: number;
  drawdown_type: DrawdownType;
  drawdown_basis: "equity" | "balance";
  daily_loss_basis: "balance" | "equity";
  consistency_rule_pct: number | null;
  min_trading_days: number;
  max_trading_days: number | null;
  news_restriction_minutes: number;
  weekend_holding_allowed: boolean;
  overnight_holding_allowed: boolean;
  max_lot_size: number | null;
  daily_reset_utc_hour: number;
  /** % of each limit deliberately left unused as a margin for error. */
  safety_buffer_pct: number;
  start_at: number;
}

export interface ChallengeDay {
  /** UTC date key, anchored to the provider's reset hour. */
  day: string;
  pnl: number;
  trades: number;
  start_equity: number;
  low_equity: number;
}

export interface ChallengeInput {
  now: number;
  rules: ChallengeRules;
  balance: number;
  equity: number;
  /** Equity at the provider's most recent daily reset. */
  dayStartEquity: number;
  /** Highest equity ever recorded on the account (drives trailing drawdown). */
  peakEquity: number;
  /** Highest end-of-day balance (drives end-of-day trailing drawdown). */
  peakEodBalance: number;
  days: ChallengeDay[];
  openLots: number;
  /** Minutes until the next high-impact release, when known. */
  minutesToHighImpactNews: number | null;
  /** Minutes until the venue's daily close, when known. */
  minutesToSessionClose: number | null;
  /** True when the next session close is the weekly close. */
  weekendClose: boolean;
  /** Realised statistics used by the pass-probability model. */
  stats: { closedTrades: number; winRate: number; avgWin: number; avgLoss: number };
}

export interface ChallengeGate {
  key: string;
  label: string;
  passed: boolean;
  detail?: string;
  /** A hard gate fails the account if breached; a soft gate only warns. */
  hard: boolean;
}

export type ChallengePosture = "push" | "normal" | "conservative" | "lockdown";

export interface ChallengeStatus {
  profit: { earned: number; target: number; progressPct: number; remaining: number };
  daily: { used: number; limit: number; usedPct: number; remaining: number };
  drawdown: { used: number; limit: number; usedPct: number; remaining: number; floorEquity: number; type: DrawdownType };
  consistency: { bestDayPnl: number; bestDaySharePct: number; limitPct: number | null; passed: boolean };
  tradingDays: { completed: number; required: number; remainingCalendar: number | null };
  gates: ChallengeGate[];
  blockers: string[];
  warnings: string[];
  /** 0..100 — combined health of every objective and every limit. */
  health: number;
  /** 0..100 — modelled probability of passing from here. */
  passProbability: number;
  /** Multiplier the AI applies to its normal position size. */
  sizeMultiplier: number;
  /** Hard cap on the risk budget for the next trade, as % of the account. */
  maxRiskPctForNextTrade: number;
  posture: ChallengePosture;
  allowed: boolean;
  notes: string[];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const pctOf = (v: number, total: number) => (total > 0 ? clamp((v / total) * 100, 0, 100) : 0);

/** UTC day key anchored to the provider's reset hour. */
export function challengeDayKey(ts: number, resetUtcHour: number): string {
  const shifted = new Date(ts - resetUtcHour * 3_600_000);
  return shifted.toISOString().slice(0, 10);
}

export function evaluateChallenge(i: ChallengeInput): ChallengeStatus {
  const R = i.rules;
  const gates: ChallengeGate[] = [];
  const notes: string[] = [];
  const push = (key: string, label: string, passed: boolean, hard: boolean, detail?: string) =>
    gates.push({ key, label, passed, hard, detail });

  const size = R.account_size > 0 ? R.account_size : Math.max(1, R.start_balance);
  const buffer = clamp(R.safety_buffer_pct, 0, 60) / 100;

  // ---- Profit objective -------------------------------------------------
  const target = (size * R.profit_target_pct) / 100;
  const earned = i.equity - R.start_balance;
  const progressPct = target > 0 ? clamp((earned / target) * 100, -100, 100) : 100;

  // ---- Daily loss -------------------------------------------------------
  const dailyBasis = R.daily_loss_basis === "equity" ? i.dayStartEquity : Math.max(i.dayStartEquity, 0) || i.balance;
  const dailyLimit = (dailyBasis * R.daily_loss_limit_pct) / 100;
  const dailyUsed = Math.max(0, i.dayStartEquity - i.equity);
  const dailyRemaining = Math.max(0, dailyLimit - dailyUsed);
  const dailyUsedPct = pctOf(dailyUsed, dailyLimit);

  // ---- Maximum drawdown -------------------------------------------------
  const ddAmount = (size * R.max_drawdown_pct) / 100;
  let floorEquity: number;
  if (R.drawdown_type === "trailing") {
    floorEquity = Math.max(i.peakEquity, R.start_balance) - ddAmount;
  } else if (R.drawdown_type === "eod_trailing") {
    floorEquity = Math.max(i.peakEodBalance, R.start_balance) - ddAmount;
  } else {
    floorEquity = R.start_balance - ddAmount;
  }
  const ddReference = R.drawdown_basis === "balance" ? i.balance : i.equity;
  const ddRemaining = Math.max(0, ddReference - floorEquity);
  const ddUsed = Math.max(0, ddAmount - ddRemaining);
  const ddUsedPct = pctOf(ddUsed, ddAmount);

  // ---- Consistency ------------------------------------------------------
  const profitDays = i.days.filter((d) => d.pnl > 0);
  const totalProfit = profitDays.reduce((a, d) => a + d.pnl, 0);
  const bestDayPnl = profitDays.reduce((a, d) => Math.max(a, d.pnl), 0);
  const bestDaySharePct = totalProfit > 0 ? (bestDayPnl / totalProfit) * 100 : 0;
  const consistencyPassed =
    R.consistency_rule_pct == null || totalProfit <= 0 || bestDaySharePct <= R.consistency_rule_pct;

  // ---- Trading days -----------------------------------------------------
  const tradingDaysDone = i.days.filter((d) => d.trades > 0).length;
  const elapsedDays = Math.floor((i.now - R.start_at) / 86_400_000);
  const remainingCalendar = R.max_trading_days != null ? Math.max(0, R.max_trading_days - elapsedDays) : null;

  // ---- Gates ------------------------------------------------------------
  push("daily_loss", `Daily loss within ${R.daily_loss_limit_pct}%`, dailyUsed < dailyLimit, true,
    `${dailyUsed.toFixed(0)} / ${dailyLimit.toFixed(0)} used`);
  push("daily_buffer", "Daily loss inside the safety buffer",
    dailyUsed < dailyLimit * (1 - buffer), false,
    `${dailyUsedPct.toFixed(0)}% of the limit consumed`);
  push("max_drawdown", `Account above the ${R.drawdown_type.replace("_", "-")} loss floor`,
    ddReference > floorEquity, true, `${ddRemaining.toFixed(0)} above floor ${floorEquity.toFixed(0)}`);
  push("drawdown_buffer", "Overall drawdown inside the safety buffer",
    ddUsed < ddAmount * (1 - buffer), false, `${ddUsedPct.toFixed(0)}% of the limit consumed`);
  push("consistency", R.consistency_rule_pct != null ? `Best day ≤ ${R.consistency_rule_pct}% of profit` : "No consistency rule",
    consistencyPassed, false,
    R.consistency_rule_pct != null && totalProfit > 0 ? `${bestDaySharePct.toFixed(0)}% today's share` : undefined);
  push("min_days", R.min_trading_days > 0 ? `Minimum ${R.min_trading_days} trading days` : "No minimum trading days",
    R.min_trading_days === 0 || tradingDaysDone >= R.min_trading_days, false,
    `${tradingDaysDone} completed`);
  push("time_limit", R.max_trading_days != null ? `Within the ${R.max_trading_days}-day window` : "No time limit",
    remainingCalendar == null || remainingCalendar > 0, true,
    remainingCalendar != null ? `${remainingCalendar} days left` : undefined);
  push("news_window", R.news_restriction_minutes > 0 ? `Outside the ±${R.news_restriction_minutes} min news window` : "No news restriction",
    R.news_restriction_minutes === 0 || i.minutesToHighImpactNews == null ||
      Math.abs(i.minutesToHighImpactNews) > R.news_restriction_minutes, true,
    i.minutesToHighImpactNews != null ? `${Math.round(i.minutesToHighImpactNews)} min to release` : undefined);
  push("overnight", R.overnight_holding_allowed ? "Overnight holding permitted" : "No overnight holding",
    R.overnight_holding_allowed || i.minutesToSessionClose == null || i.minutesToSessionClose > 30, true,
    !R.overnight_holding_allowed && i.minutesToSessionClose != null ? `${Math.round(i.minutesToSessionClose)} min to close` : undefined);
  push("weekend", R.weekend_holding_allowed ? "Weekend holding permitted" : "Flat before the weekend",
    R.weekend_holding_allowed || !i.weekendClose || (i.minutesToSessionClose ?? 999) > 60, true,
    !R.weekend_holding_allowed && i.weekendClose ? "weekly close approaching" : undefined);
  if (R.max_lot_size != null) {
    push("lot_cap", `Lot cap ${R.max_lot_size}`, i.openLots < R.max_lot_size, true,
      `${i.openLots.toFixed(2)} open`);
  }

  const hardFails = gates.filter((g) => g.hard && !g.passed);
  const softFails = gates.filter((g) => !g.hard && !g.passed);

  // ---- Health -----------------------------------------------------------
  let health = 100;
  health -= Math.min(45, dailyUsedPct * 0.45);
  health -= Math.min(45, ddUsedPct * 0.45);
  if (!consistencyPassed) health -= 10;
  if (remainingCalendar != null && remainingCalendar <= 3) health -= 10;
  health = Math.max(0, Math.round(health));

  // ---- Pass probability -------------------------------------------------
  // A transparent heuristic: survival room, progress made, realised
  // expectancy and time remaining. It is a model, not a promise.
  const survivalRoom = clamp(100 - ddUsedPct, 0, 100) / 100;
  const dailyRoom = clamp(100 - dailyUsedPct, 0, 100) / 100;
  const progress = target > 0 ? clamp(earned / target, 0, 1) : 1;
  const expectancy =
    i.stats.closedTrades >= 10
      ? clamp(
          ((i.stats.winRate / 100) * i.stats.avgWin - (1 - i.stats.winRate / 100) * Math.abs(i.stats.avgLoss)) /
            Math.max(1, Math.abs(i.stats.avgLoss)),
          -1, 1,
        )
      : 0;
  const sample = clamp(i.stats.closedTrades / 30, 0, 1);
  const timePressure = remainingCalendar == null ? 1 : clamp(remainingCalendar / 14, 0.3, 1);

  let pass =
    100 *
    (0.34 * survivalRoom +
      0.16 * dailyRoom +
      0.24 * (0.35 + 0.65 * progress) +
      0.16 * (0.5 + 0.5 * expectancy * sample) +
      0.10 * timePressure);
  if (!consistencyPassed) pass *= 0.85;
  if (R.min_trading_days > 0 && tradingDaysDone < R.min_trading_days && remainingCalendar != null && remainingCalendar < R.min_trading_days - tradingDaysDone) pass *= 0.5;
  if (hardFails.length > 0) pass = 0;
  const passProbability = Math.round(clamp(pass, 0, 99));

  // ---- Behaviour adaptation --------------------------------------------
  // Risk budget is capped by what is left of the *tighter* of the daily and
  // overall limits, minus the safety buffer, spread over the expected
  // remaining trades. Preservation always beats frequency.
  const usableDaily = dailyRemaining * (1 - buffer);
  const usableTotal = ddRemaining * (1 - buffer);
  const budget = Math.max(0, Math.min(usableDaily, usableTotal));
  // Assume at least two more trades today so one stop-out can never
  // consume the entire remaining margin for error.
  const perTradeBudget = budget / 2;
  let maxRiskPctForNextTrade = (perTradeBudget / size) * 100;

  let mult = 1;
  if (dailyUsedPct >= 50) { mult *= 0.6; notes.push("Half the daily loss limit is gone — size reduced"); }
  else if (dailyUsedPct >= 30) mult *= 0.8;
  if (ddUsedPct >= 60) { mult *= 0.5; notes.push("Overall drawdown past 60% of the limit — defensive sizing"); }
  else if (ddUsedPct >= 35) mult *= 0.75;
  if (progress >= 0.85 && target > 0) {
    mult *= 0.5;
    notes.push("Close to the profit target — protecting the pass rather than chasing extra profit");
  }
  if (R.consistency_rule_pct != null && totalProfit > 0) {
    const todayKey = challengeDayKey(i.now, R.daily_reset_utc_hour);
    const todayPnl = i.days.find((d) => d.day === todayKey)?.pnl ?? 0;
    const projectedShare = totalProfit + Math.max(0, todayPnl) > 0
      ? ((bestDayPnl === todayPnl ? todayPnl : bestDayPnl) / (totalProfit || 1)) * 100
      : 0;
    if (projectedShare > R.consistency_rule_pct * 0.8) {
      mult *= 0.6;
      notes.push("Today is dominating total profit — sizing down to satisfy the consistency rule");
    }
  }
  if (remainingCalendar != null && remainingCalendar <= 2 && progress < 0.5) {
    notes.push("Time is short but the target is far — the engine will not increase risk to catch up");
  }
  mult = Number(clamp(mult, 0.2, 1).toFixed(3));

  if (maxRiskPctForNextTrade <= 0.01) {
    maxRiskPctForNextTrade = 0;
    notes.push("No usable risk budget remains inside the safety buffer — trading paused for the day");
  }

  const posture: ChallengePosture =
    hardFails.length > 0 || maxRiskPctForNextTrade === 0
      ? "lockdown"
      : ddUsedPct >= 50 || dailyUsedPct >= 50 || softFails.length > 0
        ? "conservative"
        : progress >= 0.85
          ? "conservative"
          : "normal";

  return {
    profit: { earned, target, progressPct, remaining: Math.max(0, target - earned) },
    daily: { used: dailyUsed, limit: dailyLimit, usedPct: dailyUsedPct, remaining: dailyRemaining },
    drawdown: { used: ddUsed, limit: ddAmount, usedPct: ddUsedPct, remaining: ddRemaining, floorEquity, type: R.drawdown_type },
    consistency: { bestDayPnl, bestDaySharePct, limitPct: R.consistency_rule_pct, passed: consistencyPassed },
    tradingDays: { completed: tradingDaysDone, required: R.min_trading_days, remainingCalendar },
    gates,
    blockers: hardFails.map((g) => `${g.label}${g.detail ? ` (${g.detail})` : ""}`),
    warnings: softFails.map((g) => `${g.label}${g.detail ? ` (${g.detail})` : ""}`),
    health,
    passProbability,
    sizeMultiplier: mult,
    maxRiskPctForNextTrade: Number(maxRiskPctForNextTrade.toFixed(3)),
    posture,
    allowed: hardFails.length === 0 && maxRiskPctForNextTrade > 0,
    notes,
  };
}

/** Build engine rules from a stored challenge_profiles row. */
export function rulesFromProfile(p: any): ChallengeRules {
  const n = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    account_size: n(p?.account_size, 100000),
    start_balance: n(p?.start_balance, n(p?.account_size, 100000)),
    profit_target_pct: n(p?.profit_target_pct, 8),
    daily_loss_limit_pct: n(p?.daily_loss_limit_pct, 5),
    max_drawdown_pct: n(p?.max_drawdown_pct, 10),
    drawdown_type: (p?.drawdown_type ?? "static") as DrawdownType,
    drawdown_basis: p?.drawdown_basis === "balance" ? "balance" : "equity",
    daily_loss_basis: p?.daily_loss_basis === "equity" ? "equity" : "balance",
    consistency_rule_pct: p?.consistency_rule_pct == null ? null : Number(p.consistency_rule_pct),
    min_trading_days: n(p?.min_trading_days, 0),
    max_trading_days: p?.max_trading_days == null ? null : Number(p.max_trading_days),
    news_restriction_minutes: n(p?.news_restriction_minutes, 0),
    weekend_holding_allowed: p?.weekend_holding_allowed !== false,
    overnight_holding_allowed: p?.overnight_holding_allowed !== false,
    max_lot_size: p?.max_lot_size == null ? null : Number(p.max_lot_size),
    daily_reset_utc_hour: n(p?.daily_reset_utc_hour, 0),
    safety_buffer_pct: n(p?.safety_buffer_pct, 20),
    start_at: p?.start_at ? new Date(p.start_at).getTime() : Date.now(),
  };
}
