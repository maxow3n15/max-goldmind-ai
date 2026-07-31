// Composite confidence engine.
//
// Nine independent pillars — technical structure, news/fundamentals,
// sentiment, risk conditions, volume participation, volatility regime,
// weighted momentum, session edge and cross-market correlation — are each
// scored 0..100 and blended into a final trade confidence. Hard gates then
// decide whether the trade may be taken at all.
//
// Design intent: the extra modules make the AI SMARTER, not merely stricter.
// They shift confidence up and down; only the original three gates (final,
// technical, news) plus safety rules can veto a trade.

import type { ConfluenceReport } from "./types";
import type { CompositeConfidence, MacroReport } from "./macro.types";
import type { CorrelationReport, MomentumReport, SessionReport, VolatilityReport, VolumeReport, CandleQualityReport } from "./quant.types";

export const CONFIDENCE_GATES = {
  FINAL: 88,
  TECHNICAL: 80,
  NEWS: 75,
  MIN_RR: 2,
} as const;

const WEIGHTS = {
  technical: 0.30,
  news: 0.16,
  sentiment: 0.07,
  risk: 0.10,
  volume: 0.09,
  volatility: 0.07,
  momentum: 0.13,
  session: 0.04,
  correlation: 0.04,
} as const;

const LABELS: Record<keyof typeof WEIGHTS, string> = {
  technical: "Technical analysis",
  news: "News & fundamentals",
  sentiment: "Market sentiment",
  risk: "Risk conditions",
  volume: "Volume & participation",
  volatility: "Volatility intelligence",
  momentum: "Momentum analysis",
  session: "Trading session",
  correlation: "Correlation analysis",
};

interface Input {
  confluence: ConfluenceReport | null;
  analysis: any | null;
  macro: MacroReport | null;
  /** Risk conditions: spread ok, drawdown headroom, open-trade room, feed health. */
  riskScore: number;
  volume?: VolumeReport | null;
  volatility?: VolatilityReport | null;
  momentum?: MomentumReport | null;
  session?: SessionReport | null;
  correlation?: CorrelationReport | null;
  candleQuality?: CandleQualityReport | null;
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

export function computeComposite({
  confluence, analysis, macro, riskScore,
  volume, volatility, momentum, session, correlation, candleQuality,
}: Input): CompositeConfidence {
  const setup = analysis?.setup ?? null;
  const direction: "BUY" | "SELL" | null = setup?.direction ?? null;

  // Candle quality is folded into the technical pillar — it is a refinement
  // of price structure rather than an independent view of the market.
  const rawTechnical = Math.round(Number(confluence?.score ?? analysis?.confidence ?? 0));
  const candleAdj = candleQuality ? Math.round((candleQuality.score - 50) * 0.16) : 0;
  const technical = Math.max(0, Math.min(100, rawTechnical + candleAdj));

  const news = Math.round(directionalNewsScore(macro, direction));
  const rawSentiment = Number(macro?.sentiment_score ?? 50);
  const sentiment = Math.round(direction === "SELL" ? 100 - rawSentiment : rawSentiment);
  const risk = Math.round(Math.max(0, Math.min(100, riskScore)));
  const vol = Math.round(volume?.score ?? 50);
  const vlty = Math.round(volatility?.score ?? 50);
  const mom = Math.round(momentum?.score ?? 50);
  const sess = Math.round(session?.score ?? 55);
  const corr = Math.round(correlation?.score ?? 50);

  const scores: Record<keyof typeof WEIGHTS, number> = {
    technical, news, sentiment, risk,
    volume: vol, volatility: vlty, momentum: mom, session: sess, correlation: corr,
  };

  const notesFor: Record<keyof typeof WEIGHTS, string[]> = {
    technical: [
      ...(confluence?.supporting?.slice(0, 3) ?? []),
      ...(candleQuality ? candleQuality.notes.slice(0, 2) : []),
    ],
    news: macro ? [macro.summary].filter(Boolean) : ["Macro feed unavailable"],
    sentiment: macro ? [`Institutional / safe-haven demand ${macro.sentiment_score}/100`] : [],
    risk: [`Account and feed conditions scored ${risk}/100`],
    volume: volume?.notes ?? [],
    volatility: volatility?.notes ?? [],
    momentum: momentum?.notes ?? [],
    session: session?.notes ?? [],
    correlation: correlation?.notes?.slice(0, 4) ?? [],
  };

  const contributions = (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).map((k) => ({
    key: k,
    label: LABELS[k],
    score: scores[k],
    weight: WEIGHTS[k],
    contribution: +(scores[k] * WEIGHTS[k]).toFixed(1),
    notes: notesFor[k],
  }));

  const final = Math.round(contributions.reduce((a, c) => a + c.score * c.weight, 0));

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
    { key: "not_extended", label: "Not chasing an over-extended move", passed: !volatility?.extended_move, detail: volatility?.extended_move ? "wait for the pullback" : undefined },
  ];

  const blockers = gates.filter((g) => !g.passed).map((g) => `${g.label}${g.detail ? ` (${g.detail})` : ""}`);

  return {
    technical, news, sentiment, risk,
    volume: vol, volatility: vlty, momentum: mom, session: sess, correlation: corr,
    final,
    aligned: news >= CONFIDENCE_GATES.NEWS,
    gates,
    contributions,
    passed: blockers.length === 0,
    blockers,
  };
}

/**
 * Position-size multiplier. Ahead of a high-impact release, in thin
 * participation, or when volatility is elevated, size down — capital
 * protection first.
 */
export function sizeMultiplier(
  macro: MacroReport | null,
  composite: CompositeConfidence,
  quant?: { volume?: VolumeReport | null; volatility?: VolatilityReport | null },
): number {
  let m = 1;
  const soon = macro?.upcoming_events?.find(
    (e) => e.impact === "high" && e.hours_away != null && e.hours_away >= 0 && e.hours_away <= 4,
  );
  if (soon) m *= 0.5;
  if (macro?.geopolitical_risk === "high") m *= 0.75;
  if (composite.news < 85) m *= 0.85;
  if (quant?.volume?.participation === "weak") m *= 0.85;
  if (quant?.volatility?.atr_pct != null && quant.volatility.atr_pct > 1.2) m *= 0.8;
  return Math.max(0.25, Number(m.toFixed(2)));
}
