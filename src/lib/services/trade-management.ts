// Trade management intelligence.
//
// Entry quality is only half of profitability. This module turns the live
// volatility and momentum picture into concrete management rules for each
// open position: when to move to break-even, when to bank partials, how
// wide to trail, when to cut early and when to let a winner run.

import type { ManagementRecommendation, MomentumReport, VolatilityReport } from "./quant.types";

interface Input {
  volatility?: VolatilityReport | null;
  momentum?: MomentumReport | null;
}

export function buildManagementPlan({ volatility, momentum }: Input): ManagementRecommendation {
  const notes: string[] = [];
  const trendStrength = momentum?.trend_strength ?? 0;
  const regime = volatility?.regime ?? "transition";

  // Break-even earlier in choppy conditions, later when the trend is strong.
  let breakEven = 0.5;
  if (regime === "range") { breakEven = 0.4; notes.push("Range regime — protect the entry early (0.4R to break-even)"); }
  if (trendStrength >= 60) { breakEven = 0.7; notes.push("Strong trend — delay break-even to 0.7R and give the trade room"); }

  // Partial profit taking.
  const partialAtR = trendStrength >= 60 ? 1.5 : 1.0;
  const partialFraction = trendStrength >= 60 ? 0.33 : 0.5;
  notes.push(`Bank ${Math.round(partialFraction * 100)}% of the position at ${partialAtR}R`);

  // ATR-based trail, wider when volatility is expanding.
  let trailMult = 1.5;
  if (volatility?.atr_expanding) { trailMult = 2.0; notes.push("ATR expanding — trail at 2.0x ATR to avoid volatility stop-outs"); }
  else if (volatility?.atr_contracting) { trailMult = 1.2; notes.push("ATR contracting — tighten the trail to 1.2x ATR"); }
  else notes.push("Trail at 1.5x ATR");

  const holdWinner = trendStrength >= 60 && !(momentum?.deteriorating ?? false);
  if (holdWinner) notes.push("Trend strength high — hold winners toward the extended targets");

  const earlyExit = !!momentum?.deteriorating && trendStrength < 25;
  if (earlyExit) notes.push("Momentum deteriorating in a weak trend — exit early rather than waiting for the stop");

  return {
    break_even_at_r: breakEven,
    partial_at_r: partialAtR,
    partial_fraction: partialFraction,
    trail_atr_multiple: trailMult,
    suggested_stop_distance: volatility?.suggested_stop_distance ?? null,
    hold_winner: holdWinner,
    early_exit: earlyExit,
    notes,
  };
}
