// Smart-money / price-action primitives.
//
// Pure functions over OHLC candles. No I/O, no randomness, no clock reads —
// the same candles always produce the same structure read, which is what
// makes the confidence engine auditable.
//
// Everything tolerates short input by returning empty/neutral results.

import type { Candle } from "@/lib/indicators";
import { atr } from "@/lib/indicators";

export type StructureBias = "bullish" | "bearish" | "neutral";

export interface SwingPoint {
  index: number;
  t: number;
  price: number;
  kind: "high" | "low";
}

export interface FairValueGap {
  /** Index of the middle (displacement) candle. */
  index: number;
  t: number;
  direction: "bullish" | "bearish";
  top: number;
  bottom: number;
  /** True once price has traded back into the gap. */
  mitigated: boolean;
  size: number;
}

export interface OrderBlock {
  index: number;
  t: number;
  direction: "bullish" | "bearish";
  top: number;
  bottom: number;
  mitigated: boolean;
}

export interface LiquidityLevel {
  label: string;
  price: number;
  side: "buy_side" | "sell_side";
  /** True when price has already traded through this level. */
  swept: boolean;
}

/**
 * A swing pivot whose liquidity was taken and then rejected. This is the
 * signature that distinguishes a stop-run from a genuine break: price pierces
 * the pivot, then closes back on the origin side within a few candles.
 */
export interface SwingSweep {
  index: number;
  t: number;
  /** The pivot price that was taken. */
  level: number;
  side: "buy_side" | "sell_side";
  penetration: number;
  /** True when price closed back inside the range after piercing. */
  reclaimed: boolean;
}

/**
 * A failed order block: an OB that price closed decisively through. Once
 * violated it flips polarity and becomes support/resistance in the other
 * direction.
 */
export interface BreakerBlock {
  index: number;
  t: number;
  /** Direction the breaker now supports (opposite of the failed OB). */
  direction: "bullish" | "bearish";
  top: number;
  bottom: number;
  /** True once price has traded back into the breaker since it formed. */
  retested: boolean;
}

export interface StructureRead {
  bias: StructureBias;
  /** Last structural event, most recent first. */
  events: { type: "BOS" | "CHOCH"; direction: "bullish" | "bearish"; t: number; price: number }[];
  swingHighs: SwingPoint[];
  swingLows: SwingPoint[];
  fvgs: FairValueGap[];
  orderBlocks: OrderBlock[];
  /** Recent stop-runs on swing pivots, newest first. */
  sweeps: SwingSweep[];
  /** Violated order blocks that have flipped polarity, newest first. */
  breakers: BreakerBlock[];
  /** 0..1 position of price inside the dealing range (0 = discount low). */
  rangePosition: number | null;
  equilibrium: number | null;
  premiumDiscount: "premium" | "discount" | "equilibrium" | null;
  displacement: boolean;
  equalHighs: number[];
  equalLows: number[];
  lastPrice: number | null;
  atr: number | null;
}

const EMPTY: StructureRead = {
  bias: "neutral",
  events: [],
  swingHighs: [],
  swingLows: [],
  fvgs: [],
  orderBlocks: [],
  sweeps: [],
  breakers: [],
  rangePosition: null,
  equilibrium: null,
  premiumDiscount: null,
  displacement: false,
  equalHighs: [],
  equalLows: [],
  lastPrice: null,

  atr: null,
};

/** Fractal swing detection: a pivot with `lookback` lower highs either side. */
export function findSwings(candles: Candle[], lookback = 2): { highs: SwingPoint[]; lows: SwingPoint[] } {
  const highs: SwingPoint[] = [];
  const lows: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].h >= candles[i].h) isHigh = false;
      if (candles[j].l <= candles[i].l) isLow = false;
    }
    if (isHigh) highs.push({ index: i, t: candles[i].t, price: candles[i].h, kind: "high" });
    if (isLow) lows.push({ index: i, t: candles[i].t, price: candles[i].l, kind: "low" });
  }
  return { highs, lows };
}

/** Three-candle imbalance: gap between candle i-1 high/low and candle i+1. */
export function findFvgs(candles: Candle[], maxAgeBars = 120): FairValueGap[] {
  const out: FairValueGap[] = [];
  const start = Math.max(1, candles.length - maxAgeBars);
  for (let i = start; i < candles.length - 1; i++) {
    const prev = candles[i - 1];
    const next = candles[i + 1];
    if (next.l > prev.h) {
      const gap: FairValueGap = {
        index: i, t: candles[i].t, direction: "bullish",
        top: next.l, bottom: prev.h, mitigated: false, size: next.l - prev.h,
      };
      for (let k = i + 2; k < candles.length; k++) if (candles[k].l <= gap.top) { gap.mitigated = true; break; }
      out.push(gap);
    } else if (prev.l > next.h) {
      const gap: FairValueGap = {
        index: i, t: candles[i].t, direction: "bearish",
        top: prev.l, bottom: next.h, mitigated: false, size: prev.l - next.h,
      };
      for (let k = i + 2; k < candles.length; k++) if (candles[k].h >= gap.bottom) { gap.mitigated = true; break; }
      out.push(gap);
    }
  }
  return out;
}

/**
 * Order blocks: the last opposing candle before a displacement leg that
 * breaks structure. Approximated as the last down candle before a strong up
 * move (and vice versa).
 */
export function findOrderBlocks(candles: Candle[], atrValue: number | null, maxAgeBars = 120): OrderBlock[] {
  if (candles.length < 5) return [];
  const a = atrValue ?? null;
  const out: OrderBlock[] = [];
  const start = Math.max(1, candles.length - maxAgeBars);
  for (let i = start; i < candles.length - 1; i++) {
    const c = candles[i];
    const n = candles[i + 1];
    const body = Math.abs(n.c - n.o);
    const strong = a ? body > a * 1.1 : body > Math.abs(c.c - c.o) * 2;
    if (!strong) continue;
    if (n.c > n.o && c.c < c.o) {
      const ob: OrderBlock = { index: i, t: c.t, direction: "bullish", top: c.h, bottom: c.l, mitigated: false };
      for (let k = i + 2; k < candles.length; k++) if (candles[k].l <= ob.top) { ob.mitigated = true; break; }
      out.push(ob);
    } else if (n.c < n.o && c.c > c.o) {
      const ob: OrderBlock = { index: i, t: c.t, direction: "bearish", top: c.h, bottom: c.l, mitigated: false };
      for (let k = i + 2; k < candles.length; k++) if (candles[k].h >= ob.bottom) { ob.mitigated = true; break; }
      out.push(ob);
    }
  }
  return out;
}

/** Cluster of pivots within `tolerance` of each other = engineered liquidity. */
function clusterEquals(points: SwingPoint[], tolerance: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (Math.abs(points[i].price - points[j].price) <= tolerance) {
        out.push((points[i].price + points[j].price) / 2);
        break;
      }
    }
  }
  return out;
}

/**
 * Full structural read of one timeframe. `bias` derives from the sequence of
 * BOS/CHOCH events, not from a moving average.
 */
export function readStructure(candles: Candle[]): StructureRead {
  if (!Array.isArray(candles) || candles.length < 12) return EMPTY;

  const a = atr(candles, 14);
  const { highs, lows } = findSwings(candles, 2);
  const lastPrice = candles[candles.length - 1].c;

  // Walk pivots in time order, tracking the most recent confirmed high/low.
  const pivots = [...highs, ...lows].sort((x, y) => x.index - y.index);
  const events: StructureRead["events"] = [];
  let lastHigh: SwingPoint | null = null;
  let lastLow: SwingPoint | null = null;
  let trend: StructureBias = "neutral";

  for (const p of pivots) {
    if (p.kind === "high") {
      if (lastHigh && p.price > lastHigh.price) {
        events.push({ type: trend === "bearish" ? "CHOCH" : "BOS", direction: "bullish", t: p.t, price: p.price });
        trend = "bullish";
      }
      lastHigh = p;
    } else {
      if (lastLow && p.price < lastLow.price) {
        events.push({ type: trend === "bullish" ? "CHOCH" : "BOS", direction: "bearish", t: p.t, price: p.price });
        trend = "bearish";
      }
      lastLow = p;
    }
  }

  // Dealing range from the most recent significant swing high/low.
  const recentHighs = highs.slice(-6);
  const recentLows = lows.slice(-6);
  const rangeHigh = recentHighs.length ? Math.max(...recentHighs.map((p) => p.price)) : null;
  const rangeLow = recentLows.length ? Math.min(...recentLows.map((p) => p.price)) : null;
  let rangePosition: number | null = null;
  let equilibrium: number | null = null;
  let premiumDiscount: StructureRead["premiumDiscount"] = null;
  if (rangeHigh != null && rangeLow != null && rangeHigh > rangeLow) {
    rangePosition = (lastPrice - rangeLow) / (rangeHigh - rangeLow);
    equilibrium = (rangeHigh + rangeLow) / 2;
    premiumDiscount = rangePosition > 0.55 ? "premium" : rangePosition < 0.45 ? "discount" : "equilibrium";
  }

  // Displacement: last closed candle body materially larger than ATR.
  const lastCandle = candles[candles.length - 1];
  const displacement = a != null && Math.abs(lastCandle.c - lastCandle.o) > a * 1.3;

  const tol = (a ?? lastPrice * 0.0004) * 0.35;

  return {
    bias: trend,
    events: events.slice(-6).reverse(),
    swingHighs: recentHighs,
    swingLows: recentLows,
    fvgs: findFvgs(candles).slice(-12),
    orderBlocks: findOrderBlocks(candles, a).slice(-12),
    rangePosition: rangePosition == null ? null : Number(rangePosition.toFixed(3)),
    equilibrium: equilibrium == null ? null : Number(equilibrium.toFixed(2)),
    premiumDiscount,
    displacement,
    equalHighs: clusterEquals(recentHighs, tol),
    equalLows: clusterEquals(recentLows, tol),
    lastPrice,
    atr: a,
  };
}

/**
 * Reference liquidity levels derived from daily/weekly candles plus the
 * current session. All timestamps are UTC epoch ms.
 */
export function buildLiquidityLevels(i: {
  daily: Candle[];
  weekly?: Candle[];
  intraday?: Candle[];
  price: number | null;
}): LiquidityLevel[] {
  const out: LiquidityLevel[] = [];
  const price = i.price;
  const add = (label: string, value: number | undefined | null, side: LiquidityLevel["side"]) => {
    if (value == null || !Number.isFinite(value)) return;
    const swept = price == null ? false : side === "buy_side" ? price > value : price < value;
    out.push({ label, price: Number(value.toFixed(2)), side, swept });
  };

  const d = i.daily;
  if (d.length >= 2) {
    const prev = d[d.length - 2];
    add("Previous day high", prev.h, "buy_side");
    add("Previous day low", prev.l, "sell_side");
  }
  if (d.length >= 1) {
    const today = d[d.length - 1];
    add("Daily high", today.h, "buy_side");
    add("Daily low", today.l, "sell_side");
  }

  const w = i.weekly ?? [];
  if (w.length >= 2) {
    add("Previous week high", w[w.length - 2].h, "buy_side");
    add("Previous week low", w[w.length - 2].l, "sell_side");
  }

  // Session high/low from intraday candles inside the current UTC day.
  const intraday = i.intraday ?? [];
  if (intraday.length) {
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const today = intraday.filter((c) => c.t >= dayStart.getTime());
    if (today.length) {
      add("Session high", Math.max(...today.map((c) => c.h)), "buy_side");
      add("Session low", Math.min(...today.map((c) => c.l)), "sell_side");
    }
  }

  return out;
}
