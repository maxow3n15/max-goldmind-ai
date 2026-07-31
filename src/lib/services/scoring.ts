// Composite confidence engine.
//
// Four independent pillars — technical, news/fundamental, sentiment and risk
// conditions — are scored 0..100 and blended into a final trade confidence.
// Hard gates then decide whether the trade may be taken at all.

import type { ConfluenceReport } from "./types";
import type { CompositeConfidence, MacroReport } from "./macro.types";

export const CONFIDENCE_GATES = {
  FINAL: 88,
  TECHNICAL: 80,
  NEWS: 75,
  MIN_RR: 2,
} as const;

const WEIGHTS = { technical: 0.45, news: 0.25, sentiment: 0.15, risk: 0.15 } as const;

interface Input {
  confluence: ConfluenceReport | null;
  analysis: any | null;
  macro: MacroReport | null;
  /** Risk conditions: spread ok, drawdown headroom, open-trade room, feed health. */
  riskScore: number;
}

/**
 * News score is directional. A 90/100 bullish macro read is only worth 90 to a
 * BUY; the same read scores 100-90 = 10 for a SELL.
 */
export function directionalNewsScore(macro: MacroReport | null, direction?: "BUY" | "SELL" | null) {
  if (!macro) return 50;
  if (!direction) return 50;
  return direction === "BUY" ? macro.news_score : 100 - macro.news_score;
}

export function computeComposite({ confluence, analysis, macro, riskScore }: Input): CompositeConfidence {
  const setup = analysis?.setup ?? null;
  const direction: "BUY" | "SELL" | null = setup?.direction ?? null;

  const technical = Math.round(Number(confluence?.score ?? analysis?.confidence ?? 0));
  const news = Math.round(directionalNewsScore(macro, direction));
  const rawSentiment = Number(macro?.sentiment_score ?? 50);
  const sentiment = Math.round(direction === "SELL" ? 100 - rawSentiment : rawSentiment);
  const risk = Math.round(Math.max(0, Math.min(100, riskScore)));

  const final = Math.round(
    technical * WEIGHTS.technical +
    news * WEIGHTS.news +
    sentiment * WEIGHTS.sentiment +
    risk * WEIGHTS.risk,
  );

  const rr = Number(setup?.risk_reward ?? 0);
  const conflicting = !!macro?.headlines?.some(
    (h) => h.impact === "high" && direction && h.gold_effect !== "neutral" &&
      ((direction === "BUY" && h.gold_effect === "bearish") || (direction === "SELL" && h.gold_effect === "bullish")),
  );

  const gates = [
    { key: "final", label: `Final confidence ≥ ${CONFIDENCE_GATES.FINAL}%`, passed: final >= CONFIDENCE_GATES.FINAL, detail: `${final}%` },
    { key: "technical", label: `Technical ≥ ${CONFIDENCE_GATES.TECHNICAL}%`, passed: technical >= CONFIDENCE_GATES.TECHNICAL, detail: `${technical}%` },
    { key: "news", label: `News / fundamental ≥ ${CONFIDENCE_GATES.NEWS}%`, passed: news >= CONFIDENCE_GATES.NEWS, detail: `${news}%` },
    { key: "rr", label: `Risk / reward ≥ 1:${CONFIDENCE_GATES.MIN_RR}`, passed: rr >= CONFIDENCE_GATES.MIN_RR, detail: rr ? `1:${rr.toFixed(2)}` : "no setup" },
    { key: "structure", label: "Market structure confirms direction", passed: !!analysis?.bias && !!direction && ((direction === "BUY" && analysis.bias === "bullish") || (direction === "SELL" && analysis.bias === "bearish")), detail: analysis?.bias ?? "unknown" },
    { key: "no_conflict", label: "No conflicting high-impact news", passed: !conflicting },
    { key: "no_blackout", label: "Outside high-impact event blackout", passed: !macro?.blackout?.active, detail: macro?.blackout?.reason ?? undefined },
    { key: "post_event", label: "Post-release confirmation complete", passed: !macro?.post_event_wait, detail: macro?.post_event_wait ? "waiting for volatility spike + structure confirmation" : undefined },
    { key: "macro_feed", label: "Macro intelligence live", passed: !!macro && !macro.degraded },
  ];

  const blockers = gates.filter((g) => !g.passed).map((g) => `${g.label}${g.detail ? ` (${g.detail})` : ""}`);

  return {
    technical, news, sentiment, risk, final,
    aligned: news >= CONFIDENCE_GATES.NEWS,
    gates,
    passed: blockers.length === 0,
    blockers,
  };
}

/**
 * Position-size multiplier. Ahead of a high-impact release, or when macro is
 * only marginally supportive, size down — capital protection first.
 */
export function sizeMultiplier(macro: MacroReport | null, composite: CompositeConfidence): number {
  let m = 1;
  const soon = macro?.upcoming_events?.find(
    (e) => e.impact === "high" && e.hours_away != null && e.hours_away >= 0 && e.hours_away <= 4,
  );
  if (soon) m *= 0.5;
  if (macro?.geopolitical_risk === "high") m *= 0.75;
  if (composite.news < 85) m *= 0.85;
  return Math.max(0.25, Number(m.toFixed(2)));
}
