// Unified market-environment classifier.
//
// This is a *classification layer*, not a data source: every signal it reads
// has already been computed by the volatility, momentum and macro modules on
// the current cycle. It reshapes them into one honest reading of "what kind
// of market is this right now", with an explicit confidence on each axis and
// an "uncertain" fallback whenever the underlying modules are degraded.
//
// Pure and deterministic — the backtester, the client engine and the
// server-side scheduler all classify identically.

import type { QuantIntel } from "./quant.types";
import type { MacroReport } from "./macro.types";

export type Regime = "trending" | "ranging" | "breakout" | "reversal" | "uncertain";
export type VolatilityState = "high" | "low" | "normal";
export type NewsImpact = "high" | "medium" | "low";

export interface EnvironmentReading {
  regime: Regime;
  /** 0..100 — how strongly the evidence supports this regime label. */
  regime_confidence: number;
  volatility_state: VolatilityState;
  volatility_confidence: number;
  news_impact: NewsImpact;
  news_impact_confidence: number;
  /** True when conditions are outside normal operating range. */
  abnormal: boolean;
  notes: string[];
}

/** Stable key used for storage and for grouping historical performance. */
export function environmentKey(e: EnvironmentReading | null): string | null {
  if (!e) return null;
  return `${e.regime} · ${e.volatility_state} vol · ${e.news_impact} news`;
}

const UNCERTAIN: EnvironmentReading = {
  regime: "uncertain",
  regime_confidence: 0,
  volatility_state: "normal",
  volatility_confidence: 0,
  news_impact: "low",
  news_impact_confidence: 0,
  abnormal: false,
  notes: ["Not enough live analysis yet to classify the market environment."],
};

export function classifyEnvironment(
  quant: QuantIntel | null | undefined,
  macro: MacroReport | null | undefined,
): EnvironmentReading {
  if (!quant) return { ...UNCERTAIN, notes: [...UNCERTAIN.notes] };

  const vol = quant.volatility;
  const mom = quant.momentum;
  const notes: string[] = [];

  // ---- Volatility state -------------------------------------------------
  let volatility_state: VolatilityState = "normal";
  let volatility_confidence = 0;
  if (vol.degraded || vol.percentile == null) {
    notes.push("Volatility module is degraded — volatility state reported as normal with no confidence.");
  } else {
    const p = vol.percentile;
    if (p >= 70) { volatility_state = "high"; volatility_confidence = Math.min(95, 45 + (p - 70) * 1.5); }
    else if (p <= 30) { volatility_state = "low"; volatility_confidence = Math.min(95, 45 + (30 - p) * 1.5); }
    else { volatility_state = "normal"; volatility_confidence = 40 + (30 - Math.abs(p - 50)) * 0.8; }
    if (vol.atr_expanding && volatility_state !== "low") volatility_confidence += 8;
    if (vol.atr_contracting && volatility_state !== "high") volatility_confidence += 8;
    notes.push(`ATR in the ${p}th percentile — ${volatility_state} volatility regime.`);
  }
  volatility_confidence = clamp(Math.round(volatility_confidence));

  // ---- Regime -----------------------------------------------------------
  // Evidence is scored per candidate label; the winner carries a confidence
  // proportional to how far ahead it is, never a flat "high confidence".
  const scores: Record<Exclude<Regime, "uncertain">, number> = {
    trending: 0, ranging: 0, breakout: 0, reversal: 0,
  };

  const adx = mom.degraded ? null : mom.adx;
  const strength = mom.degraded ? 0 : mom.trend_strength;

  if (!vol.degraded) {
    if (vol.regime === "trend") scores.trending += 25;
    if (vol.regime === "range") scores.ranging += 25;
    if (vol.atr_expanding) { scores.breakout += 20; scores.trending += 8; }
    if (vol.atr_contracting) { scores.ranging += 18; }
    if (vol.percentile != null && vol.percentile >= 85) scores.breakout += 15;
    if (vol.percentile != null && vol.percentile <= 15) scores.ranging += 12;
    if (vol.extended_move) { scores.reversal += 22; scores.trending -= 6; notes.push("Move is extended — pullback / reversal risk elevated."); }
    if (vol.adr_used_pct != null && vol.adr_used_pct > 130) scores.reversal += 10;
  }

  if (adx != null) {
    if (adx >= 25) { scores.trending += 20 + Math.min(15, (adx - 25)); scores.ranging -= 10; }
    else if (adx < 18) { scores.ranging += 20; scores.trending -= 8; }
    notes.push(`ADX ${adx} · trend strength ${strength}/100.`);
  }
  if (!mom.degraded && mom.deteriorating) {
    scores.reversal += 18;
    scores.trending -= 8;
    notes.push("Momentum is deteriorating against the prevailing move.");
  }
  if (!mom.degraded && mom.macd_rising && adx != null && adx >= 22) scores.trending += 8;

  const ranked = (Object.entries(scores) as [Exclude<Regime, "uncertain">, number][])
    .sort((a, b) => b[1] - a[1]);
  const [topLabel, topScore] = ranked[0];
  const runnerUp = ranked[1]?.[1] ?? 0;

  let regime: Regime;
  let regime_confidence: number;
  // A weak or ambiguous winner is reported as "uncertain" rather than
  // dressed up as a decisive read.
  if (topScore < 20 || topScore - runnerUp < 8) {
    regime = "uncertain";
    regime_confidence = 0;
    notes.push("Regime signals conflict — no decisive classification this cycle.");
  } else {
    regime = topLabel;
    regime_confidence = clamp(Math.round(Math.min(95, 35 + topScore * 0.6 + (topScore - runnerUp) * 0.8)));
  }

  // ---- News impact ------------------------------------------------------
  let news_impact: NewsImpact = "low";
  let news_impact_confidence = 0;
  if (!macro) {
    notes.push("Macro feed not loaded — news impact unknown, reported as low with no confidence.");
  } else if (macro.degraded) {
    notes.push("Macro feed degraded — news impact cannot be assessed this cycle.");
  } else {
    const imminentHigh = macro.upcoming_events.filter(
      (e) => e.impact === "high" && e.hours_away != null && e.hours_away >= 0 && e.hours_away <= 6,
    ).length;
    const highHeadlines = macro.headlines.filter((h) => h.impact === "high").length;

    if (macro.blackout.active || macro.post_event_wait) {
      news_impact = "high";
      news_impact_confidence = 90;
      notes.push(macro.blackout.reason ?? "Inside the post-event settling window.");
    } else if (imminentHigh > 0 || highHeadlines >= 2 || macro.geopolitical_risk === "high") {
      news_impact = "high";
      news_impact_confidence = 70;
      notes.push(`${imminentHigh} high-impact event(s) within 6h · ${highHeadlines} high-impact headline(s).`);
    } else if (highHeadlines === 1 || macro.geopolitical_risk === "medium") {
      news_impact = "medium";
      news_impact_confidence = 60;
    } else {
      news_impact = "low";
      news_impact_confidence = 55;
    }
  }

  // ---- Abnormality ------------------------------------------------------
  const abnormal =
    (!vol.degraded && (vol.extended_move || (vol.percentile != null && vol.percentile >= 92))) ||
    (!!macro && !macro.degraded && macro.blackout.active) ||
    (!!vol.atr_pct && vol.atr_pct > 1.5);
  if (abnormal) notes.push("Conditions are outside the normal operating envelope — treat signals with extra caution.");

  return {
    regime,
    regime_confidence,
    volatility_state,
    volatility_confidence,
    news_impact,
    news_impact_confidence: clamp(Math.round(news_impact_confidence)),
    abnormal,
    notes,
  };
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

export const REGIME_LABEL: Record<Regime, string> = {
  trending: "Trending",
  ranging: "Ranging",
  breakout: "Breakout",
  reversal: "Reversal risk",
  uncertain: "Uncertain",
};
