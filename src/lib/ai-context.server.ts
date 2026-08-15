// Server-only evidence builder for the AI analyst.
//
// The model used to be told only "price X, timeframe Y, session Z" and asked
// for an ICT read. With no candles and no structure it could only produce a
// plausible-sounding guess, which the platform then sized real positions
// against. This module assembles the deterministic evidence the engine has
// already computed — multi-timeframe structure, liquidity, session ranges,
// quantitative modules, the economic calendar — and renders it as a compact,
// auditable brief. The model interprets that brief; it never supplies facts.

import { fetchCandles, intervalFor } from "@/lib/candles.server";
import type { Candle } from "@/lib/indicators";
import { buildMarketStructure, type MarketStructureBundle } from "@/lib/mtf.server";
import { readEconomicCalendar, type EconomicCalendarRead } from "@/lib/services/economic-calendar";
import { readSessionLiquidity, type SessionLiquidityRead } from "@/lib/services/sessions-liquidity";
import type { MacroReport } from "@/lib/services/macro.types";
import type { QuantIntel } from "@/lib/services/quant.types";
import type { StructureRead } from "@/lib/services/structure";

/** Same gold proxy the structure engine uses, so evidence never mixes feeds. */
const GOLD_SYMBOL = "GC=F";

export interface EvidenceBundle {
  generated_at: number;
  timeframe: string;
  price: number;
  structure: MarketStructureBundle;
  sessions: SessionLiquidityRead;
  calendar: EconomicCalendarRead;
  quant: QuantIntel | null;
  macro: MacroReport | null;
  /** Rendered brief handed to the model. */
  text: string;
  /**
   * True when the evidence is too thin to justify any setup. The analyst is
   * instructed to return setup_available=false in this case, and callers
   * should treat a setup returned anyway as invalid.
   */
  insufficient: boolean;
  insufficientReasons: string[];
}

const n = (v: number | null | undefined, dp = 2) =>
  v == null || !Number.isFinite(v) ? "n/a" : v.toFixed(dp);

function renderStructure(label: string, s: StructureRead | undefined): string {
  if (!s) return `${label}: unavailable`;
  const ev = s.events[0];
  const activeFvgs = s.fvgs.filter((f) => !f.mitigated).slice(-3);
  const activeObs = s.orderBlocks.filter((o) => !o.mitigated).slice(-3);
  const parts = [
    `bias=${s.bias}`,
    ev ? `last_event=${ev.type}/${ev.direction} @ ${n(ev.price)}` : "last_event=none",
    `zone=${s.premiumDiscount ?? "n/a"} (range_pos=${n(s.rangePosition, 3)}, eq=${n(s.equilibrium)})`,
    `atr=${n(s.atr, 3)}`,
    s.displacement ? "displacement=yes" : "displacement=no",
  ];
  if (activeFvgs.length) {
    parts.push(`unmitigated_fvg=[${activeFvgs.map((f) => `${f.direction} ${n(f.bottom)}-${n(f.top)}`).join("; ")}]`);
  }
  if (activeObs.length) {
    parts.push(`unmitigated_ob=[${activeObs.map((o) => `${o.direction} ${n(o.bottom)}-${n(o.top)}`).join("; ")}]`);
  }
  if (s.sweeps.length) {
    parts.push(`sweeps=[${s.sweeps.slice(0, 3).map((x) => `${x.side} ${n(x.level)}${x.reclaimed ? " reclaimed" : ""}`).join("; ")}]`);
  }
  if (s.breakers.length) {
    parts.push(`breakers=[${s.breakers.slice(0, 2).map((b) => `${b.direction} ${n(b.bottom)}-${n(b.top)}${b.retested ? " retested" : ""}`).join("; ")}]`);
  }
  if (s.equalHighs.length) parts.push(`equal_highs=[${s.equalHighs.slice(-3).map((x) => n(x)).join(", ")}]`);
  if (s.equalLows.length) parts.push(`equal_lows=[${s.equalLows.slice(-3).map((x) => n(x)).join(", ")}]`);
  return `${label}: ${parts.join(" | ")}`;
}

function renderQuant(q: QuantIntel | null): string {
  if (!q) return "Quantitative modules: unavailable.";
  const v = q.volatility, m = q.momentum, vol = q.volume, cq = q.candles, corr = q.correlation;
  return [
    `Volatility: regime=${v.regime}, atr=${n(v.atr, 3)}, atr_pct=${n(v.atr_pct, 3)}%, adr_used=${n(v.adr_used_pct, 1)}%, expanding=${v.atr_expanding}, extended_move=${v.extended_move}, suggested_stop_distance=${n(v.suggested_stop_distance, 2)}`,
    `Momentum: rsi=${n(m.rsi, 1)}, adx=${n(m.adx, 1)}, macd_hist=${n(m.macd_histogram, 4)}, trend_strength=${n(m.trend_strength, 0)}, deteriorating=${m.deteriorating}`,
    `Volume: participation=${vol.participation}, relative=${n(vol.relative_volume, 2)}x, spike=${vol.spike}, exhaustion=${vol.exhaustion}`,
    `Candle quality: ${cq.quality}, body=${n(cq.body_pct, 2)}, patterns=[${cq.patterns.slice(0, 4).join(", ")}]`,
    `Correlation: supporting=${corr.supporting}, conflicting=${corr.conflicting}, legs=[${corr.legs.map((l) => `${l.label} ${n(l.change_pct, 2)}%`).join("; ")}]`,
  ].join("\n");
}

function renderSessions(s: SessionLiquidityRead): string {
  const rows = s.sessions.map(
    (x) => `  ${x.label}: high=${n(x.high)}${x.highSwept ? " (swept)" : ""}, low=${n(x.low)}${x.lowSwept ? " (swept)" : ""}, range=${n(x.range)}, bars=${x.bars}${x.active ? ", ACTIVE" : ""}`,
  );
  const sweeps = s.sweeps.length
    ? s.sweeps.map((x) => `  ${x.label} @ ${n(x.level)} taken by ${n(x.penetration)}${x.reclaimed ? " and reclaimed" : ""}`).join("\n")
    : "  none today";
  return `Session liquidity (current: ${s.currentLabel}${s.overlap ? ", London/NY overlap" : ""}):\n${rows.join("\n")}\nSweeps today:\n${sweeps}`;
}

function renderCalendar(c: EconomicCalendarRead): string {
  if (c.stale) return "Economic calendar: schedule tables are out of date — treat event risk as UNKNOWN and stay conservative.";
  const up = c.upcoming.length
    ? c.upcoming.map((e) => `  ${e.name} in ${e.minutesAway} min (${e.impact}${e.estimated ? ", estimated timing" : ", confirmed"})`).join("\n")
    : "  nothing scheduled in the next 12h";
  const recent = c.recent.length
    ? c.recent.map((e) => `  ${e.name} released ${e.minutesAgo} min ago`).join("\n")
    : "  none in the last 2h";
  return [
    `Economic calendar (deterministic, not model-generated):`,
    `Upcoming:\n${up}`,
    `Recent:\n${recent}`,
    `Blackout: ${c.blackout.active ? c.blackout.reason : "inactive"}`,
    c.caution ? `Caution: ${c.caution}` : "",
  ].filter(Boolean).join("\n");
}

function renderMacro(m: MacroReport | null): string {
  if (!m) return "Macro: unavailable.";
  if (m.degraded) return "Macro: feed degraded — treat fundamentals as neutral and unknown.";
  return `Macro: news_score=${m.news_score}/100 (50=neutral), gold_bias=${m.gold_bias}, usd=${m.dollar_strength}, rates=${m.rate_outlook}, risk=${m.risk_environment}, yields=${m.yields}, geopolitical=${m.geopolitical_risk}. ${m.summary}`;
}

/**
 * Assemble every deterministic input into one brief.
 *
 * Never throws: any missing piece degrades the brief and, when the gaps are
 * material, flips `insufficient` so the caller can refuse to trade rather
 * than let the model improvise around the hole.
 */
export async function buildEvidence(i: {
  timeframe: string;
  price: number;
  now?: number;
  quant?: QuantIntel | null;
  macro?: MacroReport | null;
  /** Pre-built structure, when the caller already computed it this cycle. */
  structure?: MarketStructureBundle | null;
}): Promise<EvidenceBundle> {
  const now = i.now ?? Date.now();
  const timeframe = i.timeframe;

  const structure = i.structure ?? (await buildMarketStructure(timeframe));

  // Session ranges need a fine-grained intraday series and daily extremes.
  const intraTf = intervalFor("5");
  const dailyTf = intervalFor("D");
  const [intraday, daily] = await Promise.all([
    fetchCandles(GOLD_SYMBOL, intraTf.interval, intraTf.range, intraTf.ttlMs).catch(() => [] as Candle[]),
    fetchCandles(GOLD_SYMBOL, dailyTf.interval, dailyTf.range, dailyTf.ttlMs).catch(() => [] as Candle[]),
  ]);

  const sessions = readSessionLiquidity({ intraday, daily, now });
  const calendar = readEconomicCalendar(now);

  const mtf = structure.mtf;
  const entryStructure = structure.entryStructure;

  const insufficientReasons: string[] = [];
  if (structure.integrity.status === "INVALID") insufficientReasons.push("Candle feed integrity is INVALID.");
  if (mtf.degraded) insufficientReasons.push(`Multi-timeframe read degraded (missing: ${mtf.missing.join(", ") || "unknown"}).`);
  if (!entryStructure.lastPrice) insufficientReasons.push("No structural read on the trading timeframe.");
  if (structure.candleAgeMs != null && structure.candleAgeMs > 30 * 60_000) {
    insufficientReasons.push(`Newest ${timeframe} candle is ${Math.round(structure.candleAgeMs / 60_000)} min old.`);
  }
  if (calendar.blackout.active) insufficientReasons.push(`Event blackout: ${calendar.blackout.reason}`);

  const tfLines = mtf.timeframes
    .map((t) => renderStructure(`  TF ${t.timeframe} (${t.bars} bars, score ${t.score.toFixed(2)})`, t.structure))
    .join("\n");

  const text = [
    `=== DETERMINISTIC EVIDENCE (computed by the platform; treat as fact) ===`,
    `UTC now: ${new Date(now).toISOString()}`,
    `Reference spot XAUUSD: ${i.price.toFixed(2)} USD/oz`,
    `Trading timeframe: ${timeframe}`,
    `Feed integrity: ${structure.integrity.status}${structure.integrity.issues.length ? ` — ${structure.integrity.issues.slice(0, 3).join("; ")}` : ""}`,
    `Newest candle age: ${structure.candleAgeMs == null ? "n/a" : `${Math.round(structure.candleAgeMs / 60_000)} min`}`,
    ``,
    `--- Multi-timeframe bias ---`,
    `Verdict ${mtf.verdict} (score ${mtf.score.toFixed(1)}/100, alignment ${mtf.alignment.toFixed(0)}%)`,
    `HTF ${mtf.htf.verdict} (${mtf.htf.score.toFixed(1)}) | MTF ${mtf.mtf.verdict} (${mtf.mtf.score.toFixed(1)}) | LTF ${mtf.ltf.verdict} (${mtf.ltf.score.toFixed(1)})`,
    tfLines,
    ``,
    `--- Structure on the trading timeframe ---`,
    renderStructure(`  ${timeframe}`, entryStructure),
    ``,
    `--- Reference liquidity levels ---`,
    structure.levels.length
      ? structure.levels.map((l) => `  ${l.label}: ${l.price} (${l.side}${l.swept ? ", swept" : ""})`).join("\n")
      : "  none available",
    ``,
    renderSessions(sessions),
    ``,
    `--- Quantitative modules ---`,
    renderQuant(i.quant ?? null),
    ``,
    renderCalendar(calendar),
    ``,
    renderMacro(i.macro ?? null),
    ``,
    insufficientReasons.length
      ? `--- DATA GAPS (a setup is NOT permitted while any of these stand) ---\n${insufficientReasons.map((r) => `  - ${r}`).join("\n")}`
      : `--- DATA GAPS ---\n  none`,
    `=== END EVIDENCE ===`,
  ].join("\n");

  return {
    generated_at: now,
    timeframe,
    price: i.price,
    structure,
    sessions,
    calendar,
    quant: i.quant ?? null,
    macro: i.macro ?? null,
    text,
    insufficient: insufficientReasons.length > 0,
    insufficientReasons,
  };
}
