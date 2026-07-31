// Candle quality analysis.
//
// Pattern recognition is only half the story — the ENGINE cares about how
// convincing the last few candles look. Clean institutional candles lift
// confidence; doji-ish indecision trims it.

import { atr, type Candle } from "@/lib/indicators";
import type { CandleQualityReport } from "./quant.types";
import type { Direction } from "./types";

const neutral = (msg: string): CandleQualityReport => ({
  score: 50, notes: [msg], degraded: true,
  body_pct: null, upper_wick_pct: null, lower_wick_pct: null,
  patterns: [], quality: "acceptable",
});

export function analyseCandles(candles: Candle[], direction?: Direction | null): CandleQualityReport {
  if (candles.length < 5) return neutral("Not enough candles for quality analysis");

  const c = candles[candles.length - 1];
  const p = candles[candles.length - 2];
  const p2 = candles[candles.length - 3];
  const range = Math.max(1e-9, c.h - c.l);
  const body = Math.abs(c.c - c.o);
  const bodyPct = body / range;
  const upper = (c.h - Math.max(c.c, c.o)) / range;
  const lower = (Math.min(c.c, c.o) - c.l) / range;
  const bull = c.c >= c.o;
  const dir: Direction = direction ?? (bull ? "BUY" : "SELL");
  const withTrade = (isBull: boolean) => (dir === "BUY") === isBull;

  const a = atr(candles, 14);
  const patterns: string[] = [];
  const notes: string[] = [];
  let score = 50;

  // Momentum candle — large body, small wicks, bigger than average range.
  if (bodyPct >= 0.65 && (!a || range >= a * 0.9)) {
    patterns.push("Momentum candle");
    score += withTrade(bull) ? 14 : -12;
  }
  // Compression / indecision.
  if (bodyPct <= 0.25) {
    patterns.push(bodyPct <= 0.1 ? "Doji (indecision)" : "Compression candle");
    score -= 10;
  }
  // Pin bar / wick rejection.
  if (lower >= 0.55 && bodyPct < 0.45) {
    patterns.push("Bullish pin bar (lower wick rejection)");
    score += dir === "BUY" ? 12 : -10;
  }
  if (upper >= 0.55 && bodyPct < 0.45) {
    patterns.push("Bearish pin bar (upper wick rejection)");
    score += dir === "SELL" ? 12 : -10;
  }
  // Engulfing.
  const engulfs = Math.abs(c.c - c.o) > Math.abs(p.c - p.o) &&
    Math.max(c.c, c.o) >= Math.max(p.c, p.o) && Math.min(c.c, c.o) <= Math.min(p.c, p.o);
  if (engulfs) {
    patterns.push(bull ? "Bullish engulfing" : "Bearish engulfing");
    score += withTrade(bull) ? 12 : -10;
  }
  // Inside / outside bar.
  if (c.h <= p.h && c.l >= p.l) { patterns.push("Inside bar (consolidation)"); score -= 5; }
  if (c.h > p.h && c.l < p.l) { patterns.push("Outside bar (volatility expansion)"); score += withTrade(bull) ? 6 : -6; }
  // Three-candle reversal.
  const threeUp = p2.c < p2.o && p.c > p.o && c.c > c.o && c.c > p2.o;
  const threeDown = p2.c > p2.o && p.c < p.o && c.c < c.o && c.c < p2.o;
  if (threeUp) { patterns.push("Three-candle bullish reversal"); score += dir === "BUY" ? 10 : -8; }
  if (threeDown) { patterns.push("Three-candle bearish reversal"); score += dir === "SELL" ? 10 : -8; }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const quality = score >= 66 ? "institutional" : score >= 45 ? "acceptable" : "indecisive";

  notes.push(`Body ${(bodyPct * 100).toFixed(0)}% of range · upper wick ${(upper * 100).toFixed(0)}% · lower wick ${(lower * 100).toFixed(0)}%`);
  if (patterns.length) notes.push(patterns.join(" · "));
  else notes.push("No decisive candle pattern on the latest bar");

  return {
    score, notes,
    body_pct: +(bodyPct * 100).toFixed(1),
    upper_wick_pct: +(upper * 100).toFixed(1),
    lower_wick_pct: +(lower * 100).toFixed(1),
    patterns, quality,
  };
}
