// Server-side spot quote for XAUUSD.
//
// One fetcher, one short cache. Both the cron tick and the pre-execution
// revalidation read the same price, so "the price the server saw" is a single
// well-defined value rather than two independent fetches that can disagree.

import type { MarketQuote } from "@/lib/market-data.types";

const CACHE_MS = 5_000;

let cached: { at: number; quote: MarketQuote } | null = null;
let inflight: Promise<MarketQuote | null> | null = null;

async function load(): Promise<MarketQuote | null> {
  try {
    const res = await fetch("https://api.gold-api.com/price/XAU", {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    const mid = Number(j?.price);
    if (!Number.isFinite(mid) || mid <= 0) return null;
    const bid = +(mid - 0.15).toFixed(2);
    const ask = +(mid + 0.15).toFixed(2);
    const quote: MarketQuote = {
      symbol: "XAUUSD",
      bid,
      ask,
      spread: +(ask - bid).toFixed(3),
      mid: +mid.toFixed(3),
      timestamp: Date.now(),
      source: "gold-api.com (public spot)",
    };
    cached = { at: Date.now(), quote };
    return quote;
  } catch {
    return null;
  }
}

/** Fresh spot within CACHE_MS, deduplicated across concurrent callers. */
export async function fetchSpotQuote(): Promise<MarketQuote | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.quote;
  if (!inflight) {
    inflight = load().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}
