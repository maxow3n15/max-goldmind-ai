// Server-only OHLCV loader.
//
// Pulls candles for gold and the correlated markets from a keyless public
// chart API, with a short in-memory cache so repeated analysis cycles do
// not re-hit the network. Failures degrade gracefully to empty arrays —
// every consuming module already handles missing data.

import type { Candle } from "@/lib/indicators";
import { validateSeries, type IntegrityReport } from "./services/candle-integrity";

const BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const UA = "Mozilla/5.0 (compatible; GoldMindAI/1.0)";

interface Entry { at: number; candles: Candle[]; report: IntegrityReport }
const cache = new Map<string, Entry>();

/** Integrity verdict for the last fetch of a series, keyed like the cache. */
export function lastIntegrityReport(symbol: string, interval: string, range: string): IntegrityReport | null {
  return cache.get(`${symbol}|${interval}|${range}`)?.report ?? null;
}

/** Map an app timeframe (minutes / "D") onto provider interval + range. */
export function intervalFor(timeframe: string): { interval: string; range: string; ttlMs: number } {
  switch (timeframe) {
    case "1": return { interval: "1m", range: "1d", ttlMs: 45_000 };
    case "5": return { interval: "5m", range: "5d", ttlMs: 60_000 };
    case "15": return { interval: "15m", range: "1mo", ttlMs: 120_000 };
    case "30": return { interval: "30m", range: "1mo", ttlMs: 180_000 };
    case "60": return { interval: "60m", range: "3mo", ttlMs: 300_000 };
    case "240": return { interval: "1h", range: "6mo", ttlMs: 600_000 };
    default: return { interval: "1d", range: "1y", ttlMs: 900_000 };
  }
}

export async function fetchCandles(symbol: string, interval: string, range: string, ttlMs: number): Promise<Candle[]> {
  const key = `${symbol}|${interval}|${range}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.candles;

  try {
    const url = `${BASE}/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
    const res = await fetch(url, { headers: { "User-Agent": UA, accept: "application/json" } });
    if (!res.ok) throw new Error(`chart ${res.status}`);
    const j: any = await res.json();
    const r = j?.chart?.result?.[0];
    const ts: number[] = r?.timestamp ?? [];
    const q = r?.indicators?.quote?.[0] ?? {};
    const out: Candle[] = [];
    for (let i = 0; i < ts.length; i++) {
      const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i], v = q.volume?.[i];
      if ([o, h, l, c].some((x) => x == null || !Number.isFinite(Number(x)))) continue;
      out.push({ t: ts[i] * 1000, o: Number(o), h: Number(h), l: Number(l), c: Number(c), v: Number(v ?? 0) });
    }
    // Every series is cleaned and graded before anything structural reads it.
    const { candles, report } = validateSeries(out);
    cache.set(key, { at: Date.now(), candles, report });
    return candles;
  } catch {
    // Serve a stale cache entry rather than nothing.
    if (hit) return hit.candles;
    const empty = validateSeries([]);
    cache.set(key, { at: Date.now(), candles: [], report: empty.report });
    return [];
  }
}

/** Percentage change of a symbol over the last `bars` candles. */
export async function changePct(symbol: string, bars = 8): Promise<number | null> {
  const candles = await fetchCandles(symbol, "15m", "5d", 180_000);
  if (candles.length < bars + 1) return null;
  const a = candles[candles.length - 1 - bars].c;
  const b = candles[candles.length - 1].c;
  if (!a) return null;
  return ((b - a) / a) * 100;
}
