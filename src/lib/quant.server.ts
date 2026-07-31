// Server-only quantitative intelligence builder.
//
// Combines volume, volatility, momentum, candle quality and cross-market
// correlation into one cached report per timeframe/direction.

import { fetchCandles, changePct, intervalFor } from "./candles.server";
import { analyseVolume } from "./services/volume";
import { analyseVolatility } from "./services/volatility";
import { analyseMomentum } from "./services/momentum";
import { analyseCandles } from "./services/candle-quality";
import { analyseCorrelation, CORRELATION_MAP } from "./services/correlation";
import type { QuantIntel } from "./services/quant.types";
import type { Direction } from "./services/types";

/** Gold futures track spot XAUUSD closely and, unlike spot FX, carry volume. */
const GOLD_SYMBOL = "GC=F";

interface CacheEntry { at: number; value: QuantIntel }
const cache = new Map<string, CacheEntry>();
const CACHE_MS = 45_000;

export async function buildQuantIntel(timeframe: string, direction: Direction | null): Promise<QuantIntel> {
  const key = `${timeframe}|${direction ?? "none"}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const { interval, range, ttlMs } = intervalFor(timeframe);
  const candles = await fetchCandles(GOLD_SYMBOL, interval, range, ttlMs);

  // Correlated markets are fetched in parallel and are entirely optional.
  const changes: Record<string, number | null> = {};
  await Promise.all(
    CORRELATION_MAP.map(async (m) => {
      changes[m.symbol] = await changePct(m.symbol).catch(() => null);
    }),
  );

  const volume = analyseVolume(candles, direction);
  const volatility = analyseVolatility(candles);
  const momentum = analyseMomentum(candles, direction);
  const candleQuality = analyseCandles(candles, direction);
  const correlation = analyseCorrelation({ changes, direction });

  const value: QuantIntel = {
    generated_at: Date.now(),
    timeframe,
    price: candles.length ? candles[candles.length - 1].c : null,
    volume,
    volatility,
    momentum,
    candles: candleQuality,
    correlation,
    degraded: candles.length < 40,
  };

  cache.set(key, { at: Date.now(), value });
  return value;
}
