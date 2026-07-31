// Human-readable pre-execution trade report. Generated BEFORE any order is
// submitted so the reasoning is always logged with the trade.

import type { CompositeConfidence, MacroReport, TradeExplanationReport } from "./macro.types";
import type { ConfluenceReport, TradePlan } from "./types";

export function buildTradeReport(args: {
  plan: TradePlan;
  analysis: any | null;
  confluence: ConfluenceReport | null;
  macro: MacroReport | null;
  composite: CompositeConfidence;
}): TradeExplanationReport {
  const { plan, analysis, confluence, macro, composite } = args;
  const bullish = plan.direction === "BUY";

  const technical = (confluence?.breakdown ?? [])
    .filter((b) => b.passed)
    .map((b) => `${b.label}${b.detail ? ` — ${b.detail}` : ""}`);

  const drivers = bullish ? macro?.bullish_drivers ?? [] : macro?.bearish_drivers ?? [];
  const news = [
    ...drivers,
    macro ? `USD ${macro.dollar_strength} · rates ${macro.rate_outlook} · yields ${macro.yields}` : null,
    macro ? `Macro news score ${macro.news_score}/100 (${macro.gold_bias} for gold)` : null,
  ].filter(Boolean) as string[];

  const risks: string[] = [];
  for (const e of macro?.upcoming_events ?? []) {
    if (e.impact === "high") {
      risks.push(`${e.name} ${e.hours_away != null ? `in ~${e.hours_away}h` : e.when}${e.priced_in ? " (largely priced in)" : ""}`);
    }
  }
  if (macro?.geopolitical_risk === "high") risks.push("Elevated geopolitical risk — headline-driven volatility");
  if (analysis?.invalidation) risks.push(`Invalidation: ${analysis.invalidation}`);
  const contra = (macro?.headlines ?? []).filter(
    (h) => h.impact !== "low" && ((bullish && h.gold_effect === "bearish") || (!bullish && h.gold_effect === "bullish")),
  );
  contra.slice(0, 2).forEach((h) => risks.push(`Counter-headline: ${h.title}`));

  return {
    direction: plan.direction,
    confidence: composite.final,
    entry: plan.entry,
    stop_loss: plan.stop_loss,
    take_profit: plan.take_profit_1,
    risk_reward: plan.risk_reward,
    technical_confirmations: technical,
    news_confirmations: news,
    sentiment: macro
      ? `${macro.risk_environment} · safe-haven demand ${macro.sentiment_score}/100`
      : "unavailable",
    risks,
    entry_reason: plan.reason,
  };
}

export function formatTradeReport(r: TradeExplanationReport): string {
  const lines = [
    `${r.direction} XAUUSD — confidence ${r.confidence}%`,
    `Entry ${r.entry.toFixed(2)} · SL ${r.stop_loss.toFixed(2)} · TP ${r.take_profit.toFixed(2)} · R:R 1:${r.risk_reward.toFixed(2)}`,
    "",
    "Technical:",
    ...r.technical_confirmations.map((t) => `  ✓ ${t}`),
    "Fundamental:",
    ...r.news_confirmations.map((t) => `  ✓ ${t}`),
    `Sentiment: ${r.sentiment}`,
  ];
  if (r.risks.length) {
    lines.push("Risks:", ...r.risks.map((t) => `  ! ${t}`));
  }
  return lines.join("\n");
}
