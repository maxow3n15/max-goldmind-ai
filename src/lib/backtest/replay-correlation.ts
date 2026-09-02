// Point-in-time cross-market correlation for pipeline replay.
//
// Unlike macro/news — where no historical archive exists — the correlated
// markets themselves (DXY, yields, silver, equity indices) have full price
// history. This module rebuilds the exact correlation input the live engine
// uses (% change over a lookback window) from those series, honouring the same
// no-lookahead rule as the rest of the replay: only closes at `t <= bar.t` are
// ever read.

import type { Candle } from "@/lib/indicators";
import { analyseCorrelation, CORRELATION_MAP } from "@/lib/services/correlation";
import type { CorrelationReport } from "@/lib/services/quant.types";
import type { Direction } from "@/lib/services/types";

export interface CorrelationSeries {
  /** Yahoo-style symbol from CORRELATION_MAP. */
  symbol: string;
  candles: Candle[];
}

/** Lookback used by the live correlation read, in milliseconds (4 hours). */
export const CORRELATION_LOOKBACK_MS = 4 * 60 * 60 * 1000;

interface Cursor {
  symbol: string;
  candles: Candle[];
  /** Index of the newest candle at or before the current bar time. */
  head: number;
}

export class ReplayCorrelation {
  private readonly cursors: Cursor[] = [];
  private readonly lookbackMs: number;

  constructor(series: CorrelationSeries[], lookbackMs = CORRELATION_LOOKBACK_MS) {
    this.lookbackMs = lookbackMs;
    for (const s of series) {
      if (!s.candles.length) continue;
      // Ascending by time is an invariant every consumer below relies on.
      const sorted = [...s.candles].sort((a, b) => a.t - b.t);
      this.cursors.push({ symbol: s.symbol, candles: sorted, head: -1 });
    }
  }

  get symbols(): string[] {
    return this.cursors.map((c) => c.symbol);
  }

  /**
   * Percentage change of each correlated market over the lookback window as it
   * would have been observable at `now`. Cursors only move forward, so a
   * sequential replay stays O(n) across the whole run.
   */
  changesAt(now: number): Record<string, number | null> {
    const out: Record<string, number | null> = {};
    for (const m of CORRELATION_MAP) out[m.symbol] = null;

    for (const c of this.cursors) {
      while (c.head + 1 < c.candles.length && c.candles[c.head + 1].t <= now) c.head += 1;
      if (c.head < 0) continue;

      const latest = c.candles[c.head];
      // Stale series (a closed market, or a gap in the provider's history)
      // must not be presented as a live reading.
      if (now - latest.t > this.lookbackMs * 2) continue;

      const target = latest.t - this.lookbackMs;
      let refIndex = -1;
      for (let i = c.head; i >= 0; i--) {
        if (c.candles[i].t <= target) { refIndex = i; break; }
      }
      if (refIndex < 0) continue;

      const ref = c.candles[refIndex].c;
      if (!Number.isFinite(ref) || ref <= 0) continue;
      out[c.symbol] = ((latest.c - ref) / ref) * 100;
    }
    return out;
  }

  /** The live correlation report, rebuilt for this bar. */
  reportAt(now: number, direction: Direction | null): CorrelationReport {
    const changes = this.changesAt(now);
    const measured = Object.values(changes).filter((v) => v != null).length;
    const report = analyseCorrelation({ changes, direction });
    if (measured === 0) {
      return { ...report, degraded: true, notes: ["No correlated market data at this bar"] };
    }
    return {
      ...report,
      notes: [`Historical correlation from ${measured} market(s)`, ...report.notes],
    };
  }
}

/** Server-side loader for the correlated markets over the backtest window. */
export async function loadCorrelationSeries(
  interval: string,
  range: string,
): Promise<CorrelationSeries[]> {
  const { fetchCandles } = await import("@/lib/candles.server");
  const out: CorrelationSeries[] = [];
  for (const m of CORRELATION_MAP) {
    try {
      const candles = await fetchCandles(m.symbol, interval, range, 900_000);
      if (candles.length) out.push({ symbol: m.symbol, candles });
    } catch {
      // A missing leg degrades the report; it never fails the backtest.
    }
  }
  return out;
}
