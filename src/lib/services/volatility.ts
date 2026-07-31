// Volatility intelligence.
//
// Volatility never blocks a trade on its own — it tells the engine whether
// conditions favour trend or range trading, how far the stop should sit,
// and whether price is over-extended and likely to pull back first.

import { atrSeries, historicalVolatility, percentileRank, type Candle } from "@/lib/indicators";
import type { VolatilityReport } from "./quant.types";

const neutral = (msg: string): VolatilityReport => ({
  score: 50, notes: [msg], degraded: true,
  atr: null, atr_pct: null, atr_expanding: false, atr_contracting: false,
  historical_vol: null, adr: null, adr_used_pct: null, session_volatility: null,
  percentile: null, regime: "transition", extended_move: false, suggested_stop_distance: null,
});

/** Group intraday candles into UTC days and average the daily range. */
function averageDailyRange(candles: Candle[], days = 10): number | null {
  const byDay = new Map<string, { hi: number; lo: number }>();
  for (const c of candles) {
    const k = new Date(c.t).toISOString().slice(0, 10);
    const d = byDay.get(k);
    if (!d) byDay.set(k, { hi: c.h, lo: c.l });
    else { d.hi = Math.max(d.hi, c.h); d.lo = Math.min(d.lo, c.l); }
  }
  const ranges = [...byDay.values()].map((d) => d.hi - d.lo);
  if (ranges.length < 3) return null;
  const use = ranges.slice(-days - 1, -1).length ? ranges.slice(-days - 1, -1) : ranges;
  return use.reduce((a, b) => a + b, 0) / use.length;
}

function todayRange(candles: Candle[]): number | null {
  const today = new Date().toISOString().slice(0, 10);
  const rows = candles.filter((c) => new Date(c.t).toISOString().slice(0, 10) === today);
  if (!rows.length) return null;
  return Math.max(...rows.map((r) => r.h)) - Math.min(...rows.map((r) => r.l));
}

export function analyseVolatility(candles: Candle[]): VolatilityReport {
  if (candles.length < 30) return neutral("Not enough candles for volatility analysis");

  const closes = candles.map((c) => c.c);
  const price = closes[closes.length - 1];
  const series = atrSeries(candles, 14);
  const cur = series.length ? series[series.length - 1] : null;
  if (cur == null || !price) return neutral("ATR unavailable");

  const prev = series.length > 6 ? series[series.length - 6] : cur;
  const expanding = cur > prev * 1.1;
  const contracting = cur < prev * 0.9;
  const pct = (cur / price) * 100;
  const pctile = percentileRank(series.slice(-100), cur);
  const hv = historicalVolatility(closes, 20);
  const adr = averageDailyRange(candles);
  const tRange = todayRange(candles);
  const adrUsed = adr && tRange ? Math.round((tRange / adr) * 100) : null;

  // Session volatility: average range of the last 8 candles.
  const recent = candles.slice(-8);
  const sessionVol = recent.reduce((a, c) => a + (c.h - c.l), 0) / recent.length;

  // Over-extension: the latest candle is a big multiple of ATR, or price has
  // already burned through most of the average daily range.
  const lastRange = candles[candles.length - 1].h - candles[candles.length - 1].l;
  const extended = lastRange > cur * 2.2 || (adrUsed != null && adrUsed > 130);

  let score = 55;
  const notes: string[] = [];
  let regime: VolatilityReport["regime"] = "transition";

  if (pctile != null) {
    if (pctile >= 70) { regime = "trend"; score += 10; notes.push(`ATR in the ${pctile}th percentile — expansion favours trend trading`); }
    else if (pctile <= 30) { regime = "range"; score -= 4; notes.push(`ATR in the ${pctile}th percentile — compression favours range tactics`); }
    else notes.push(`ATR in the ${pctile}th percentile — balanced conditions`);
  }
  if (expanding) { score += 8; notes.push("ATR expanding — volatility is building"); if (regime === "transition") regime = "trend"; }
  if (contracting) { score -= 3; notes.push("ATR contracting — expect tighter ranges"); if (regime === "transition") regime = "range"; }
  if (adrUsed != null) notes.push(`${adrUsed}% of the 10-day average daily range used today`);
  if (extended) { score -= 18; notes.push("Move is extended — elevated probability of a pullback before continuation"); }
  if (pct > 1.2) { score -= 6; notes.push(`ATR is ${pct.toFixed(2)}% of price — widen stops and size down`); }

  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score, notes,
    atr: +cur.toFixed(2),
    atr_pct: +pct.toFixed(3),
    atr_expanding: expanding,
    atr_contracting: contracting,
    historical_vol: hv != null ? +hv.toFixed(3) : null,
    adr: adr != null ? +adr.toFixed(2) : null,
    adr_used_pct: adrUsed,
    session_volatility: +sessionVol.toFixed(2),
    percentile: pctile,
    regime,
    extended_move: extended,
    suggested_stop_distance: +(cur * 1.5).toFixed(2),
  };
}
