// Server-only multi-timeframe builder.
//
// Fetches candles for every configured timeframe in parallel (each request is
// individually cached in candles.server), builds the structural report and the
// reference liquidity levels. One cached report per timeframe key.

import { fetchCandles, intervalFor } from "@/lib/candles.server";
import type { Candle } from "@/lib/indicators";
import { buildMultiTimeframeReport, type MultiTimeframeReport, type TimeframeKey } from "./services/mtf";
import { buildLiquidityLevels, readStructure, type LiquidityLevel, type StructureRead } from "./services/structure";

/** Gold futures track spot XAUUSD closely and carry real volume. */
const GOLD_SYMBOL = "GC=F";

const TF_KEYS: TimeframeKey[] = ["1", "5", "15", "30", "60", "240", "D"];

export interface MarketStructureBundle {
  generated_at: number;
  mtf: MultiTimeframeReport;
  /** Structure on the user's trading timeframe. */
  entryStructure: StructureRead;
  levels: LiquidityLevel[];
  /** Newest candle open time on the trading timeframe, UTC ms. */
  lastCandleAt: number | null;
  candleAgeMs: number | null;
  degraded: boolean;
}

let cache: { at: number; timeframe: string; value: MarketStructureBundle } | null = null;
const CACHE_MS = 30_000;

export async function buildMarketStructure(timeframe: string): Promise<MarketStructureBundle> {
  if (cache && cache.timeframe === timeframe && Date.now() - cache.at < CACHE_MS) return cache.value;

  const entries = await Promise.all(
    TF_KEYS.map(async (tf) => {
      const { interval, range, ttlMs } = intervalFor(tf);
      const candles = await fetchCandles(GOLD_SYMBOL, interval, range, ttlMs).catch(() => [] as Candle[]);
      return [tf, candles] as const;
    }),
  );

  const byTf = Object.fromEntries(entries) as Partial<Record<TimeframeKey, Candle[]>>;
  const mtf = buildMultiTimeframeReport(byTf);

  const tfKey = (TF_KEYS.includes(timeframe as TimeframeKey) ? timeframe : "15") as TimeframeKey;
  const entryCandles = byTf[tfKey] ?? [];
  const entryStructure = readStructure(entryCandles);

  const daily = byTf["D"] ?? [];
  const weekly = aggregateWeekly(daily);
  const levels = buildLiquidityLevels({
    daily,
    weekly,
    intraday: byTf["15"] ?? byTf["5"] ?? [],
    price: entryStructure.lastPrice,
  });

  const lastCandleAt = entryCandles.length ? entryCandles[entryCandles.length - 1].t : null;

  const value: MarketStructureBundle = {
    generated_at: Date.now(),
    mtf,
    entryStructure,
    levels,
    lastCandleAt,
    candleAgeMs: lastCandleAt == null ? null : Date.now() - lastCandleAt,
    degraded: mtf.degraded,
  };

  cache = { at: Date.now(), timeframe, value };
  return value;
}

/** Roll daily candles into ISO weeks so PWH/PWL are real, not guessed. */
function aggregateWeekly(daily: Candle[]): Candle[] {
  if (!daily.length) return [];
  const weeks = new Map<string, Candle>();
  for (const c of daily) {
    const d = new Date(c.t);
    // Week key: UTC year + week number derived from Thursday-anchored ISO rule.
    const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNum = (tmp.getUTCDay() + 6) % 7;
    tmp.setUTCDate(tmp.getUTCDate() - dayNum + 3);
    const firstThursday = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 4));
    const week = 1 + Math.round(((tmp.getTime() - firstThursday.getTime()) / 86400000 - 3) / 7);
    const key = `${tmp.getUTCFullYear()}-${week}`;

    const existing = weeks.get(key);
    if (!existing) {
      weeks.set(key, { ...c });
    } else {
      existing.h = Math.max(existing.h, c.h);
      existing.l = Math.min(existing.l, c.l);
      existing.c = c.c;
      existing.v += c.v;
    }
  }
  return [...weeks.values()].sort((a, b) => a.t - b.t);
}
