import { createFileRoute } from "@tanstack/react-router";
import type { MarketDataEnvelope, MarketQuote } from "@/lib/market-data.types";

// Public read-only endpoint. Proxies to a configurable external backend
// (MARKET_API_URL) if set, otherwise falls back to a free public gold price
// feed. This keeps broker credentials off the frontend and gives us a stable
// URL for the client hook to poll.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
} as const;

function json(body: MarketDataEnvelope, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

async function fetchFromBackend(url: string): Promise<MarketQuote> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`backend ${res.status}`);
  const j: any = await res.json();
  // Accept either our own shape or a generic { bid, ask } shape.
  const bid = Number(j.bid ?? j.quote?.bid);
  const ask = Number(j.ask ?? j.quote?.ask);
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) throw new Error("bad backend payload");
  return {
    symbol: "XAUUSD",
    bid, ask,
    spread: +(ask - bid).toFixed(3),
    mid: +((ask + bid) / 2).toFixed(3),
    timestamp: Number(j.timestamp ?? j.quote?.timestamp ?? Date.now()),
    source: String(j.source ?? "External Backend"),
  };
}

async function fetchFromPublicFeed(): Promise<MarketQuote> {
  // gold-api.com is a keyless public spot-gold endpoint.
  const res = await fetch("https://api.gold-api.com/price/XAU", {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`public feed ${res.status}`);
  const j: any = await res.json();
  const mid = Number(j.price);
  if (!Number.isFinite(mid)) throw new Error("bad public payload");
  // Synthesize a realistic ~30 cent spread around mid.
  const halfSpread = 0.15;
  const bid = +(mid - halfSpread).toFixed(2);
  const ask = +(mid + halfSpread).toFixed(2);
  return {
    symbol: "XAUUSD",
    bid, ask,
    spread: +(ask - bid).toFixed(3),
    mid: +mid.toFixed(3),
    timestamp: j.updatedAtTs ? Number(j.updatedAtTs) * 1000 : Date.now(),
    source: "gold-api.com (public spot)",
  };
}

export const Route = createFileRoute("/api/public/market/xauusd")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async () => {
        const backend = process.env.MARKET_API_URL;
        try {
          const quote = backend ? await fetchFromBackend(backend) : await fetchFromPublicFeed();
          return json({ ok: true, quote });
        } catch (e: any) {
          return json({ ok: false, error: e?.message ?? "market data unavailable" }, 502);
        }
      },
    },
  },
});
