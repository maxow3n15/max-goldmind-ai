// Deterministic trading-session liquidity map.
//
// Pure functions over intraday candles + an explicit "now" timestamp. No
// clock reads inside the maths, no randomness — the same inputs always
// produce the same session read, which is what makes it auditable and
// testable.
//
// Session windows are expressed in UTC and deliberately fixed. Gold trades
// around the clock, so these are liquidity regimes rather than exchange
// hours: they mark when Asian, London and New York desks are active.

import type { Candle } from "@/lib/indicators";

export type SessionKey = "asian" | "london" | "newyork";

export interface SessionWindow {
  key: SessionKey;
  label: string;
  /** Inclusive start hour, UTC. */
  startHour: number;
  /** Exclusive end hour, UTC. */
  endHour: number;
}

export const SESSION_WINDOWS: SessionWindow[] = [
  { key: "asian", label: "Asian", startHour: 0, endHour: 8 },
  { key: "london", label: "London", startHour: 7, endHour: 16 },
  { key: "newyork", label: "New York", startHour: 12, endHour: 21 },
];

export interface SessionRange {
  key: SessionKey;
  label: string;
  /** UTC ms bounds of the window actually measured. */
  from: number;
  to: number;
  high: number | null;
  low: number | null;
  /** high - low, or null when no candles fell inside the window. */
  range: number | null;
  bars: number;
  /** True while `now` sits inside this window. */
  active: boolean;
  /** True once price has traded above the session high after it formed. */
  highSwept: boolean;
  lowSwept: boolean;
}

export interface LiquiditySweep {
  /** Which reference level was taken. */
  label: string;
  side: "buy_side" | "sell_side";
  level: number;
  /** Candle that pierced the level. */
  t: number;
  /** How far beyond the level price traded, in price units. */
  penetration: number;
  /**
   * True when price pierced the level and closed back on the origin side —
   * the classic stop-run / reversal signature rather than a clean break.
   */
  reclaimed: boolean;
}

export interface SessionLiquidityRead {
  /** UTC day the read covers (midnight ms). */
  dayStart: number;
  /** Session active at `now`, or null outside all windows. */
  current: SessionKey | null;
  /** Human label(s) — overlaps produce e.g. "London/New York". */
  currentLabel: string;
  /** True during the London/NY overlap, the highest-liquidity period. */
  overlap: boolean;
  sessions: SessionRange[];
  /** Sweeps of session highs/lows and prior-day extremes, newest first. */
  sweeps: LiquiditySweep[];
}

const EMPTY = (dayStart: number): SessionLiquidityRead => ({
  dayStart,
  current: null,
  currentLabel: "unknown",
  overlap: false,
  sessions: [],
  sweeps: [],
});

/** UTC midnight of the day containing `ms`. */
export function utcDayStart(ms: number): number {
  const d = new Date(ms);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

/** Sessions containing this instant. Empty outside every window. */
export function sessionsAt(ms: number): SessionWindow[] {
  const h = new Date(ms).getUTCHours();
  return SESSION_WINDOWS.filter((w) => h >= w.startHour && h < w.endHour);
}

/**
 * Full session liquidity read.
 *
 * `intraday` should be a fine-grained series (5m–15m works well); anything
 * coarser than 1h makes session boundaries meaningless and the function
 * simply reports fewer bars.
 */
export function readSessionLiquidity(i: {
  intraday: Candle[];
  now: number;
  /** Optional daily candles, used for prior-day sweep references. */
  daily?: Candle[];
}): SessionLiquidityRead {
  const dayStart = utcDayStart(i.now);
  const candles = Array.isArray(i.intraday) ? i.intraday : [];
  if (candles.length === 0) return EMPTY(dayStart);

  const today = candles.filter((c) => c.t >= dayStart && c.t <= i.now);
  const active = sessionsAt(i.now);
  const activeKeys = new Set(active.map((w) => w.key));

  const sessions: SessionRange[] = SESSION_WINDOWS.map((w) => {
    const from = dayStart + w.startHour * 3_600_000;
    const to = dayStart + w.endHour * 3_600_000;
    const inWindow = today.filter((c) => c.t >= from && c.t < to);
    const high = inWindow.length ? Math.max(...inWindow.map((c) => c.h)) : null;
    const low = inWindow.length ? Math.min(...inWindow.map((c) => c.l)) : null;

    // A level is only "swept" by candles that print after it was established.
    // Using the window's own candles would make every high self-swept.
    const after = today.filter((c) => c.t >= to);
    const highSwept = high != null && after.some((c) => c.h > high);
    const lowSwept = low != null && after.some((c) => c.l < low);

    return {
      key: w.key,
      label: w.label,
      from,
      to,
      high: high == null ? null : Number(high.toFixed(2)),
      low: low == null ? null : Number(low.toFixed(2)),
      range: high != null && low != null ? Number((high - low).toFixed(2)) : null,
      bars: inWindow.length,
      active: activeKeys.has(w.key),
      highSwept,
      lowSwept,
    };
  });

  // ---- Sweeps of the levels that actually hold resting liquidity ---------
  const refs: { label: string; level: number; side: LiquiditySweep["side"]; from: number }[] = [];
  for (const s of sessions) {
    if (s.high != null) refs.push({ label: `${s.label} session high`, level: s.high, side: "buy_side", from: s.to });
    if (s.low != null) refs.push({ label: `${s.label} session low`, level: s.low, side: "sell_side", from: s.to });
  }
  const d = i.daily ?? [];
  if (d.length >= 2) {
    const prev = d[d.length - 2];
    refs.push({ label: "Previous day high", level: prev.h, side: "buy_side", from: dayStart });
    refs.push({ label: "Previous day low", level: prev.l, side: "sell_side", from: dayStart });
  }

  const sweeps: LiquiditySweep[] = [];
  for (const ref of refs) {
    if (!Number.isFinite(ref.level)) continue;
    for (const c of today) {
      if (c.t < ref.from) continue;
      if (ref.side === "buy_side" && c.h > ref.level) {
        sweeps.push({
          label: ref.label,
          side: ref.side,
          level: Number(ref.level.toFixed(2)),
          t: c.t,
          penetration: Number((c.h - ref.level).toFixed(2)),
          reclaimed: c.c < ref.level,
        });
        break;
      }
      if (ref.side === "sell_side" && c.l < ref.level) {
        sweeps.push({
          label: ref.label,
          side: ref.side,
          level: Number(ref.level.toFixed(2)),
          t: c.t,
          penetration: Number((ref.level - c.l).toFixed(2)),
          reclaimed: c.c > ref.level,
        });
        break;
      }
    }
  }
  sweeps.sort((a, b) => b.t - a.t);

  const overlap = activeKeys.has("london") && activeKeys.has("newyork");
  return {
    dayStart,
    current: active[0]?.key ?? null,
    currentLabel: active.length ? active.map((w) => w.label).join("/") : "Off-session",
    overlap,
    sessions,
    sweeps: sweeps.slice(0, 8),
  };
}
