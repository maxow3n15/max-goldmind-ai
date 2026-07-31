// Advanced momentum analysis.
//
// Six indicators are blended into ONE weighted momentum score that is
// directional (scored for the proposed trade). Indicators influence
// confidence — they are never hard entry conditions.

import { adx as adxCalc, cci as cciCalc, macd as macdCalc, roc as rocCalc, rsi as rsiCalc, stochRsi, type Candle } from "@/lib/indicators";
import type { MomentumReport } from "./quant.types";
import type { Direction } from "./types";

const WEIGHTS = { rsi: 0.2, stoch: 0.12, macd: 0.24, adx: 0.2, cci: 0.12, roc: 0.12 } as const;

const neutral = (msg: string): MomentumReport => ({
  score: 50, notes: [msg], degraded: true,
  rsi: null, stoch_rsi: null, macd_histogram: null, macd_rising: false,
  adx: null, plus_di: null, minus_di: null, cci: null, roc: null,
  trend_strength: 0, deteriorating: false,
});

export function analyseMomentum(candles: Candle[], direction?: Direction | null): MomentumReport {
  if (candles.length < 40) return neutral("Not enough candles for momentum analysis");
  const closes = candles.map((c) => c.c);

  const rsi = rsiCalc(closes, 14);
  const stoch = stochRsi(closes, 14);
  const m = macdCalc(closes);
  const a = adxCalc(candles, 14);
  const cci = cciCalc(candles, 20);
  const roc = rocCalc(closes, 10);

  // Every sub-score is expressed 0..100 in favour of a BUY, then flipped
  // for a SELL at the end. No direction → measured against recent drift.
  const dir: Direction = direction ?? (closes[closes.length - 1] >= closes[closes.length - 10] ? "BUY" : "SELL");
  const parts: { key: keyof typeof WEIGHTS; value: number }[] = [];
  const notes: string[] = [];

  if (rsi != null) {
    // 50 → neutral; overbought above 75 loses some value for fresh longs.
    let s = 50 + (rsi - 50) * 1.4;
    if (rsi > 78) s -= (rsi - 78) * 2;
    parts.push({ key: "rsi", value: s });
    notes.push(`RSI ${rsi.toFixed(1)}`);
  }
  if (stoch != null) {
    let s = stoch;
    if (stoch > 90) s = 70; else if (stoch < 10) s = 30;
    parts.push({ key: "stoch", value: s });
    notes.push(`Stoch RSI ${stoch.toFixed(0)}`);
  }
  if (m) {
    const scale = Math.abs(closes[closes.length - 1]) * 0.001 || 1;
    let s = 50 + Math.max(-40, Math.min(40, (m.histogram / scale) * 20));
    if (m.rising) s += 5; else s -= 5;
    parts.push({ key: "macd", value: s });
    notes.push(`MACD histogram ${m.histogram.toFixed(2)} ${m.rising ? "rising" : "falling"}`);
  }
  if (a) {
    const bias = a.plus_di - a.minus_di;
    const strength = Math.min(1, a.adx / 40);
    const s = 50 + Math.max(-40, Math.min(40, bias)) * strength;
    parts.push({ key: "adx", value: s });
    notes.push(`ADX ${a.adx.toFixed(1)} (${a.adx >= 25 ? "trending" : "ranging"}), +DI ${a.plus_di.toFixed(0)} / -DI ${a.minus_di.toFixed(0)}`);
  }
  if (cci != null) {
    parts.push({ key: "cci", value: 50 + Math.max(-40, Math.min(40, cci / 5)) });
    notes.push(`CCI ${cci.toFixed(0)}`);
  }
  if (roc != null) {
    parts.push({ key: "roc", value: 50 + Math.max(-35, Math.min(35, roc * 25)) });
    notes.push(`ROC(10) ${roc.toFixed(2)}%`);
  }

  if (!parts.length) return neutral("Momentum indicators unavailable");

  const totalW = parts.reduce((s, p) => s + WEIGHTS[p.key], 0);
  const bullScore = parts.reduce((s, p) => s + p.value * WEIGHTS[p.key], 0) / totalW;
  const score = Math.max(0, Math.min(100, Math.round(dir === "BUY" ? bullScore : 100 - bullScore)));

  const trendStrength = a ? Math.max(0, Math.min(100, Math.round((a.adx / 50) * 100))) : 0;
  const deteriorating = score < 40 || (!!m && !m.rising && score < 50);

  notes.unshift(`Weighted momentum ${score}/100 for a ${dir}`);

  return {
    score, notes,
    rsi: rsi != null ? +rsi.toFixed(1) : null,
    stoch_rsi: stoch != null ? +stoch.toFixed(1) : null,
    macd_histogram: m ? +m.histogram.toFixed(3) : null,
    macd_rising: !!m?.rising,
    adx: a ? +a.adx.toFixed(1) : null,
    plus_di: a ? +a.plus_di.toFixed(1) : null,
    minus_di: a ? +a.minus_di.toFixed(1) : null,
    cci: cci != null ? +cci.toFixed(1) : null,
    roc: roc != null ? +roc.toFixed(3) : null,
    trend_strength: trendStrength,
    deteriorating,
  };
}
