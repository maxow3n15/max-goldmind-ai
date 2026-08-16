// Point-in-time historical data layer for pipeline replay.
//
// The live decision path reads cached, always-current candle series. A
// backtest must never do that: at bar `t` the engine may only see data that
// existed at `t`. This module rebuilds the multi-timeframe view *incrementally*
// as the simulation walks forward, so a look-ahead leak is structurally
// impossible rather than merely discouraged:
//
//   - higher timeframes are aggregated from the execution series bar by bar,
//     including the currently-forming (partial) bucket, exactly as a live feed
//     would present them;
//   - nothing is ever read from an index beyond the cursor;
//   - `assertNoLookahead` is exported so tests can prove the invariant.
//
// Timeframes finer than the execution series cannot be reconstructed and are
// reported as missing rather than guessed.

import type { Candle } from "@/lib/indicators";
import type { TimeframeKey } from "@/lib/services/mtf";

export const TIMEFRAME_MINUTES: Record<TimeframeKey, number> = {
  "1": 1,
  "5": 5,
  "15": 15,
  "30": 30,
  "60": 60,
  "240": 240,
  D: 1440,
};

const ALL_TIMEFRAMES: TimeframeKey[] = ["1", "5", "15", "30", "60", "240", "D"];

/** Rolling window kept per timeframe. Enough for every structural read. */
export const DEFAULT_WINDOW_BARS = 300;

function bucketStart(t: number, minutes: number): number {
  const ms = minutes * 60_000;
  return Math.floor(t / ms) * ms;
}

function pushBar(series: Candle[], bar: Candle, minutes: number, maxBars: number) {
  const start = bucketStart(bar.t, minutes);
  const last = series[series.length - 1];
  if (last && last.t === start) {
    last.h = Math.max(last.h, bar.h);
    last.l = Math.min(last.l, bar.l);
    last.c = bar.c;
    last.v += bar.v;
    return;
  }
  series.push({ t: start, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v });
  if (series.length > maxBars) series.shift();
}

/**
 * Throws when any candle in `series` starts after `t`. Used by the replay
 * engine's own assertions and by the no-lookahead test.
 */
export function assertNoLookahead(label: string, series: Candle[], t: number) {
  for (const c of series) {
    if (c.t > t) {
      throw new Error(
        `Lookahead leak in ${label}: candle at ${new Date(c.t).toISOString()} is newer than the replay cursor ${new Date(t).toISOString()}`,
      );
    }
  }
}

export class PointInTimeSeries {
  private readonly base: Candle[];
  private readonly baseTf: TimeframeKey;
  private readonly maxBars: number;
  private readonly series = new Map<TimeframeKey, Candle[]>();
  private cursor = -1;

  constructor(base: Candle[], baseTf: TimeframeKey, maxBars = DEFAULT_WINDOW_BARS) {
    this.base = base;
    this.baseTf = baseTf;
    this.maxBars = maxBars;
    const baseMinutes = TIMEFRAME_MINUTES[baseTf];
    for (const tf of ALL_TIMEFRAMES) {
      if (TIMEFRAME_MINUTES[tf] >= baseMinutes) this.series.set(tf, []);
    }
  }

  /** Timestamp of the bar the cursor currently sits on. */
  get time(): number {
    return this.cursor >= 0 ? this.base[this.cursor].t : Number.NEGATIVE_INFINITY;
  }

  get index(): number {
    return this.cursor;
  }

  get length(): number {
    return this.base.length;
  }

  bar(index = this.cursor): Candle {
    return this.base[index];
  }

  /** Move the cursor forward one bar, folding it into every timeframe. */
  advance(): Candle {
    this.cursor += 1;
    const bar = this.base[this.cursor];
    for (const [tf, series] of this.series) {
      pushBar(series, bar, TIMEFRAME_MINUTES[tf], this.maxBars);
    }
    return bar;
  }

  /** Candles for a timeframe as they existed at the cursor. */
  seriesFor(tf: TimeframeKey): Candle[] {
    return this.series.get(tf) ?? [];
  }

  /** Execution-timeframe series as it existed at the cursor. */
  execution(): Candle[] {
    return this.seriesFor(this.baseTf);
  }

  /** Everything `buildMultiTimeframeReport` needs. */
  byTimeframe(): Partial<Record<TimeframeKey, Candle[]>> {
    const out: Partial<Record<TimeframeKey, Candle[]>> = {};
    for (const [tf, series] of this.series) out[tf] = series;
    return out;
  }

  /** Timeframes this base series cannot reconstruct. */
  missingTimeframes(): TimeframeKey[] {
    return ALL_TIMEFRAMES.filter((tf) => !this.series.has(tf));
  }

  /** Assert the invariant for every timeframe at the current cursor. */
  verifyNoLookahead() {
    const t = this.time;
    for (const [tf, series] of this.series) assertNoLookahead(`timeframe ${tf}`, series, t);
  }
}
