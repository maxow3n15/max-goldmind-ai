// Multi-timeframe bias engine.
//
// Reads structure on every configured timeframe and blends the results into
// one directional verdict. Higher timeframes carry more weight — deliberately
// NOT a flat average, because a 1M CHOCH must never outvote the daily trend.

import type { Candle } from "@/lib/indicators";
import { ema } from "@/lib/indicators";
import { readStructure, type StructureRead } from "./structure";

export type TimeframeKey = "1" | "5" | "15" | "30" | "60" | "240" | "D";

export type BiasVerdict =
  | "STRONG BULLISH"
  | "BULLISH"
  | "NEUTRAL"
  | "BEARISH"
  | "STRONG BEARISH";

/** Relative influence of each timeframe on the final verdict. */
export const TIMEFRAME_WEIGHTS: Record<TimeframeKey, number> = {
  D: 30,
  "240": 22,
  "60": 16,
  "30": 11,
  "15": 10,
  "5": 7,
  "1": 4,
};

export const HTF: TimeframeKey[] = ["D", "240", "60"];
export const MTF: TimeframeKey[] = ["30", "15"];
export const LTF: TimeframeKey[] = ["5", "1"];

export interface TimeframeRead {
  timeframe: TimeframeKey;
  /** -1..1 directional score for this timeframe alone. */
  score: number;
  bias: "bullish" | "bearish" | "neutral";
  structure: StructureRead;
  /** Number of candles the read is based on — 0 means unavailable. */
  bars: number;
  lastCandleAt: number | null;
}

export interface MultiTimeframeReport {
  generated_at: number;
  verdict: BiasVerdict;
  /** -100..100 weighted directional score. */
  score: number;
  htf: { verdict: BiasVerdict; score: number };
  mtf: { verdict: BiasVerdict; score: number };
  ltf: { verdict: BiasVerdict; score: number };
  /** 0..100 — how much the timeframes agree with each other. */
  alignment: number;
  timeframes: TimeframeRead[];
  /** Timeframes that returned no usable candles. */
  missing: TimeframeKey[];
  degraded: boolean;
}

function verdictFor(score: number): BiasVerdict {
  if (score >= 55) return "STRONG BULLISH";
  if (score >= 18) return "BULLISH";
  if (score <= -55) return "STRONG BEARISH";
  if (score <= -18) return "BEARISH";
  return "NEUTRAL";
}

/**
 * Single-timeframe directional score in -1..1, combining structural events,
 * trend location and premium/discount positioning.
 */
export function scoreTimeframe(candles: Candle[]): { score: number; structure: StructureRead } {
  const structure = readStructure(candles);
  if (candles.length < 12) return { score: 0, structure };

  let score = 0;

  // Structure carries the most weight: latest event, then confirmation.
  const [latest, previous] = structure.events;
  if (latest) score += latest.direction === "bullish" ? 0.45 : -0.45;
  if (previous && latest && previous.direction === latest.direction) {
    score += latest.direction === "bullish" ? 0.15 : -0.15;
  }
  if (structure.bias === "bullish") score += 0.1;
  if (structure.bias === "bearish") score -= 0.1;

  // Trend location relative to the 50 EMA.
  const closes = candles.map((c) => c.c);
  const e = ema(closes, Math.min(50, Math.max(8, Math.floor(closes.length / 3))));
  const price = closes[closes.length - 1];
  if (e != null && price) {
    const dev = (price - e) / e;
    score += Math.max(-0.2, Math.min(0.2, dev * 40));
  }

  // Discount favours longs, premium favours shorts (mean-reversion of entry
  // quality, not of direction — hence a small weight).
  if (structure.premiumDiscount === "discount") score += 0.08;
  if (structure.premiumDiscount === "premium") score -= 0.08;

  // Displacement in the direction of the latest event confirms intent.
  if (structure.displacement && latest) score += latest.direction === "bullish" ? 0.07 : -0.07;

  return { score: Math.max(-1, Math.min(1, Number(score.toFixed(4)))), structure };
}

function weightedGroup(reads: TimeframeRead[], keys: TimeframeKey[]) {
  const subset = reads.filter((r) => keys.includes(r.timeframe) && r.bars > 0);
  const total = subset.reduce((a, r) => a + TIMEFRAME_WEIGHTS[r.timeframe], 0);
  if (!total) return { verdict: "NEUTRAL" as BiasVerdict, score: 0 };
  const score = Math.round(
    (subset.reduce((a, r) => a + r.score * TIMEFRAME_WEIGHTS[r.timeframe], 0) / total) * 100,
  );
  return { verdict: verdictFor(score), score };
}

/**
 * Build the full report. `candlesByTimeframe` may omit timeframes; missing
 * data is reported rather than guessed.
 */
export function buildMultiTimeframeReport(
  candlesByTimeframe: Partial<Record<TimeframeKey, Candle[]>>,
): MultiTimeframeReport {
  const keys = Object.keys(TIMEFRAME_WEIGHTS) as TimeframeKey[];
  const missing: TimeframeKey[] = [];

  const timeframes: TimeframeRead[] = keys.map((tf) => {
    const candles = candlesByTimeframe[tf] ?? [];
    if (candles.length < 12) missing.push(tf);
    const { score, structure } = scoreTimeframe(candles);
    return {
      timeframe: tf,
      score,
      bias: score > 0.15 ? "bullish" : score < -0.15 ? "bearish" : "neutral",
      structure,
      bars: candles.length,
      lastCandleAt: candles.length ? candles[candles.length - 1].t : null,
    };
  });

  const available = timeframes.filter((r) => r.bars >= 12);
  const totalWeight = available.reduce((a, r) => a + TIMEFRAME_WEIGHTS[r.timeframe], 0);
  const score = totalWeight
    ? Math.round((available.reduce((a, r) => a + r.score * TIMEFRAME_WEIGHTS[r.timeframe], 0) / totalWeight) * 100)
    : 0;

  // Alignment: share of weight pointing the same way as the blended score.
  let agreeing = 0;
  for (const r of available) {
    if (score === 0) continue;
    if (Math.sign(r.score) === Math.sign(score)) agreeing += TIMEFRAME_WEIGHTS[r.timeframe];
    else if (r.bias === "neutral") agreeing += TIMEFRAME_WEIGHTS[r.timeframe] * 0.4;
  }
  const alignment = totalWeight ? Math.round((agreeing / totalWeight) * 100) : 0;

  return {
    generated_at: Date.now(),
    verdict: verdictFor(score),
    score,
    htf: weightedGroup(timeframes, HTF),
    mtf: weightedGroup(timeframes, MTF),
    ltf: weightedGroup(timeframes, LTF),
    alignment,
    timeframes,
    missing,
    degraded: available.length < 4,
  };
}

/** Coarse direction of a verdict, for alignment checks against a setup. */
export function verdictDirection(v: BiasVerdict): "bullish" | "bearish" | "neutral" {
  if (v.includes("BULLISH")) return "bullish";
  if (v.includes("BEARISH")) return "bearish";
  return "neutral";
}
