// Pure technical-indicator math. No I/O, no randomness, no dependencies.
// Every function tolerates short/empty input by returning null.

export interface Candle {
  t: number; // epoch ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export const last = <T,>(a: T[]): T | null => (a.length ? a[a.length - 1] : null);

export function sma(values: number[], period: number): number | null {
  if (values.length < period || period <= 0) return null;
  let s = 0;
  for (let i = values.length - period; i < values.length; i++) s += values[i];
  return s / period;
}

/** Full EMA series (same length as input, seeded with an SMA). */
export function emaSeries(values: number[], period: number): number[] {
  if (!values.length || period <= 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0];
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function ema(values: number[], period: number): number | null {
  const s = emaSeries(values, period);
  return s.length ? s[s.length - 1] : null;
}

export function stdev(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v);
}

/** Where `value` sits inside `sample`, expressed 0..100. */
export function percentileRank(sample: number[], value: number): number | null {
  const s = sample.filter(Number.isFinite);
  if (s.length < 5) return null;
  const below = s.filter((x) => x <= value).length;
  return Math.round((below / s.length) * 100);
}

export function trueRanges(candles: Candle[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    out.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
  }
  return out;
}

/** Wilder-smoothed ATR series (aligned to candles[period..]). */
export function atrSeries(candles: Candle[], period = 14): number[] {
  const tr = trueRanges(candles);
  if (tr.length < period) return [];
  const out: number[] = [];
  let prev = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out.push(prev);
  for (let i = period; i < tr.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out.push(prev);
  }
  return out;
}

export function atr(candles: Candle[], period = 14): number | null {
  const s = atrSeries(candles, period);
  return s.length ? s[s.length - 1] : null;
}

export function rsiSeries(values: number[], period = 14): number[] {
  if (values.length <= period) return [];
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= period; loss /= period;
  const out: number[] = [loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)];
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(0, d)) / period;
    loss = (loss * (period - 1) + Math.max(0, -d)) / period;
    out.push(loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
  }
  return out;
}

export function rsi(values: number[], period = 14): number | null {
  const s = rsiSeries(values, period);
  return s.length ? s[s.length - 1] : null;
}

/** Stochastic RSI (0..100) of the RSI series. */
export function stochRsi(values: number[], period = 14): number | null {
  const r = rsiSeries(values, period);
  if (r.length < period) return null;
  const win = r.slice(-period);
  const lo = Math.min(...win), hi = Math.max(...win);
  if (hi === lo) return 50;
  return ((win[win.length - 1] - lo) / (hi - lo)) * 100;
}

export function macd(values: number[], fast = 12, slow = 26, signal = 9) {
  if (values.length < slow + signal) return null;
  const f = emaSeries(values, fast), s = emaSeries(values, slow);
  const line = f.map((x, i) => x - s[i]).slice(slow - 1);
  const sig = emaSeries(line, signal);
  const macdLine = line[line.length - 1];
  const signalLine = sig[sig.length - 1];
  const hist = macdLine - signalLine;
  const prevHist = line[line.length - 2] - sig[sig.length - 2];
  return { macd: macdLine, signal: signalLine, histogram: hist, rising: hist > prevHist };
}

/** Wilder ADX plus directional indicators. */
export function adx(candles: Candle[], period = 14) {
  if (candles.length < period * 2 + 1) return null;
  const plus: number[] = [], minus: number[] = [], tr: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    const up = c.h - p.h, dn = p.l - c.l;
    plus.push(up > dn && up > 0 ? up : 0);
    minus.push(dn > up && dn > 0 ? dn : 0);
    tr.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
  }
  const smooth = (arr: number[]) => {
    let acc = arr.slice(0, period).reduce((a, b) => a + b, 0);
    const out = [acc];
    for (let i = period; i < arr.length; i++) {
      acc = acc - acc / period + arr[i];
      out.push(acc);
    }
    return out;
  };
  const sTr = smooth(tr), sP = smooth(plus), sM = smooth(minus);
  const dx: number[] = [];
  for (let i = 0; i < sTr.length; i++) {
    const pdi = sTr[i] ? (sP[i] / sTr[i]) * 100 : 0;
    const mdi = sTr[i] ? (sM[i] / sTr[i]) * 100 : 0;
    const sum = pdi + mdi;
    dx.push(sum ? (Math.abs(pdi - mdi) / sum) * 100 : 0);
  }
  if (dx.length < period) return null;
  let adxVal = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dx.length; i++) adxVal = (adxVal * (period - 1) + dx[i]) / period;
  const i = sTr.length - 1;
  return {
    adx: adxVal,
    plus_di: sTr[i] ? (sP[i] / sTr[i]) * 100 : 0,
    minus_di: sTr[i] ? (sM[i] / sTr[i]) * 100 : 0,
  };
}

export function cci(candles: Candle[], period = 20): number | null {
  if (candles.length < period) return null;
  const tp = candles.map((c) => (c.h + c.l + c.c) / 3).slice(-period);
  const mean = tp.reduce((a, b) => a + b, 0) / period;
  const md = tp.reduce((a, b) => a + Math.abs(b - mean), 0) / period;
  if (!md) return 0;
  return (tp[tp.length - 1] - mean) / (0.015 * md);
}

export function roc(values: number[], period = 10): number | null {
  if (values.length <= period) return null;
  const prev = values[values.length - 1 - period];
  if (!prev) return null;
  return ((values[values.length - 1] - prev) / prev) * 100;
}

/** Annualisation-free historical volatility: stdev of log returns, in %. */
export function historicalVolatility(values: number[], period = 20): number | null {
  if (values.length < period + 1) return null;
  const rets: number[] = [];
  for (let i = values.length - period; i < values.length; i++) {
    if (values[i - 1] > 0) rets.push(Math.log(values[i] / values[i - 1]));
  }
  const sd = stdev(rets);
  return sd == null ? null : sd * 100;
}

export const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
