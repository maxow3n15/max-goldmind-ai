// Adaptive capital preservation.
//
// The static gates never change with circumstance: a 76% threshold means
// the same thing on day one of a clean account as it does halfway into a
// drawdown. This layer makes preservation respond to the state the account
// is actually in — deeper drawdown tightens both the confidence bar and the
// position size, a well-calibrated engine on a healthy account gets its
// full allowance back, and a proven-over-confident engine is discounted.
//
// Pure and deterministic, so the backtester and the live engine agree.

import type { CalibrationReport } from "./calibration";

export type PreservationTier = "full" | "measured" | "defensive" | "protective" | "lockdown";

export interface AdaptiveInput {
  /** Current drawdown from peak equity, in percent. */
  drawdownPct: number;
  /** The user's configured maximum drawdown, in percent. */
  maxDrawdownPct: number;
  /** Today's loss so far, in percent of balance. */
  dailyLossPct: number;
  maxDailyLossPct: number;
  consecutiveLosses: number;
  /** Realised P&L of the most recent closed trades, newest first. */
  recentPnl: number[];
  calibration: CalibrationReport | null;
  /** Base confidence gate before adaptation (76 by default). */
  baseThreshold: number;
}

export interface AdaptivePolicy {
  tier: PreservationTier;
  /** Multiplier applied to the risk budget, 0..1. */
  sizeMultiplier: number;
  /** The confidence gate the engine should actually use right now. */
  confidenceThreshold: number;
  /** How much the threshold was raised above the base. */
  thresholdUplift: number;
  /** Trading is suspended entirely at this tier. */
  halted: boolean;
  /** 0..100 — how much of the account's risk capacity remains healthy. */
  health: number;
  reasons: string[];
}

/** Never let adaptation loosen the user's floor. */
const MAX_UPLIFT = 12;
const MIN_MULT = 0.2;

export function buildAdaptivePolicy(i: AdaptiveInput): AdaptivePolicy {
  const reasons: string[] = [];
  const maxDd = Math.max(0.1, i.maxDrawdownPct);
  const ddUsed = Math.max(0, Math.min(1, i.drawdownPct / maxDd));
  const dailyUsed = Math.max(0, Math.min(1, i.dailyLossPct / Math.max(0.1, i.maxDailyLossPct)));

  // --- Tier from the deepest pressure currently on the account ----------
  const pressure = Math.max(ddUsed, dailyUsed * 0.9, Math.min(1, i.consecutiveLosses / 4));

  let tier: PreservationTier;
  let sizeMultiplier: number;
  let uplift: number;

  if (pressure >= 0.9) { tier = "lockdown"; sizeMultiplier = 0; uplift = MAX_UPLIFT; }
  else if (pressure >= 0.7) { tier = "protective"; sizeMultiplier = 0.35; uplift = 8; }
  else if (pressure >= 0.45) { tier = "defensive"; sizeMultiplier = 0.55; uplift = 5; }
  else if (pressure >= 0.2) { tier = "measured"; sizeMultiplier = 0.8; uplift = 2; }
  else { tier = "full"; sizeMultiplier = 1; uplift = 0; }

  if (tier !== "full") {
    reasons.push(
      ddUsed >= dailyUsed
        ? `${i.drawdownPct.toFixed(2)}% into a ${i.maxDrawdownPct}% drawdown allowance — capacity used ${(ddUsed * 100).toFixed(0)}%`
        : `${i.dailyLossPct.toFixed(2)}% of today's ${i.maxDailyLossPct}% loss budget already spent`,
    );
  }

  // --- Losing streaks compound the tightening ---------------------------
  if (i.consecutiveLosses >= 2) {
    sizeMultiplier *= i.consecutiveLosses >= 3 ? 0.5 : 0.75;
    uplift += i.consecutiveLosses >= 3 ? 4 : 2;
    reasons.push(`${i.consecutiveLosses} consecutive losses — size cut and the confidence bar raised until form returns`);
  }

  // --- Recent form: is the last handful of trades actually working? -----
  const recent = i.recentPnl.slice(0, 10);
  if (recent.length >= 5) {
    const net = recent.reduce((a, b) => a + b, 0);
    const winRate = recent.filter((p) => p > 0).length / recent.length;
    if (net < 0 && winRate < 0.4) {
      sizeMultiplier *= 0.75;
      uplift += 3;
      reasons.push(`Recent form is poor (${Math.round(winRate * 100)}% win rate over the last ${recent.length}) — trading smaller and more selectively`);
    } else if (net > 0 && winRate >= 0.6 && tier === "full") {
      reasons.push(`Recent form is strong (${Math.round(winRate * 100)}% win rate over the last ${recent.length}) — full risk allowance retained`);
    }
  }

  // --- Calibration feedback --------------------------------------------
  const cal = i.calibration;
  if (cal && cal.sample >= 20) {
    if (cal.bias != null && cal.bias > 8) {
      uplift += Math.min(6, Math.round(cal.bias / 3));
      reasons.push(`Confidence has been running ${cal.bias.toFixed(0)} points over-optimistic — the gate is raised to compensate`);
    }
    if (!cal.reliable) {
      sizeMultiplier *= 0.85;
      reasons.push("Confidence scores are not yet well calibrated — sizing held back until they are");
    } else if (tier === "full") {
      reasons.push("Confidence is well calibrated against realised outcomes — no discount applied");
    }
    if (cal.reliable_threshold != null && cal.reliable_threshold > i.baseThreshold) {
      const need = cal.reliable_threshold - i.baseThreshold;
      uplift = Math.max(uplift, need);
      reasons.push(`Historically only setups at ${cal.reliable_threshold}%+ have been profitable — the gate is lifted to match`);
    }
  }

  uplift = Math.max(0, Math.min(MAX_UPLIFT, Math.round(uplift)));
  sizeMultiplier = tier === "lockdown" ? 0 : Math.max(MIN_MULT, Math.min(1, Number(sizeMultiplier.toFixed(3))));

  const health = Math.max(0, Math.round(100 - pressure * 100));

  if (tier === "lockdown") {
    reasons.push("Capital preservation lockdown: no new risk is taken until the account recovers or the day resets");
  }

  return {
    tier,
    sizeMultiplier,
    confidenceThreshold: Math.min(99, i.baseThreshold + uplift),
    thresholdUplift: uplift,
    halted: tier === "lockdown",
    health,
    reasons: reasons.length ? reasons : ["Account healthy — full risk allowance and the standard confidence gate apply"],
  };
}

export const TIER_LABEL: Record<PreservationTier, string> = {
  full: "Full allowance",
  measured: "Measured",
  defensive: "Defensive",
  protective: "Protective",
  lockdown: "Lockdown",
};
