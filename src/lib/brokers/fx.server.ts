// Broker-backed FX quote sources (server-only).
//
// The execution account is the authority on its own currency, so conversions
// are sourced from the SAME broker that will fill the order whenever that
// broker can price currency pairs. No third-party rate, no hardcoded value,
// no cached rate older than the freshness window in `fx.ts`.

import type { FxQuote, FxQuoteFetcher } from "@/lib/services/fx";

/** Convert "GBP_USD" into a broker-native symbol. */
const compact = (pair: string) => pair.replace("_", "");

function parseTime(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v > 1e12 ? v : v * 1000;
  const t = Date.parse(String(v ?? ""));
  return Number.isFinite(t) ? t : NaN;
}

/**
 * OANDA v3 pricing on the trading account itself. Returns null when the pair
 * is not tradeable on the account, which lets the resolver try the inverse or
 * a cross instead of failing outright.
 */
export function oandaFxFetcher(
  base: string,
  accountId: string,
  headers: Record<string, string>,
): FxQuoteFetcher {
  return async (pair: string): Promise<FxQuote | null> => {
    const res = await fetch(
      `${base}/v3/accounts/${accountId}/pricing?instruments=${encodeURIComponent(pair)}`,
      { headers },
    );
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as Record<string, any> | null;
    const p = body?.["prices"]?.[0];
    if (!p) return null;
    if (p.tradeable === false && !p.closeoutBid) return null;
    const bid = Number(p.bids?.[0]?.price ?? p.closeoutBid);
    const ask = Number(p.asks?.[0]?.price ?? p.closeoutAsk);
    const timestamp = parseTime(p.time);
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || !Number.isFinite(timestamp)) return null;
    return { pair, bid, ask, timestamp, source: "oanda-pricing" };
  };
}

/** MetaApi current price for the equivalent FX symbol (e.g. GBPUSD). */
export function metaapiFxFetcher(
  base: string,
  accountId: string,
  headers: Record<string, string>,
): FxQuoteFetcher {
  return async (pair: string): Promise<FxQuote | null> => {
    const symbol = compact(pair);
    const res = await fetch(
      `${base}/users/current/accounts/${accountId}/symbols/${encodeURIComponent(symbol)}/current-price?keepSubscription=true`,
      { headers },
    );
    if (!res.ok) return null;
    const p = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const bid = Number(p?.["bid"]);
    const ask = Number(p?.["ask"]);
    const timestamp = parseTime(p?.["time"] ?? p?.["brokerTime"]);
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || !Number.isFinite(timestamp)) return null;
    return { pair, bid, ask, timestamp, source: "metaapi-price" };
  };
}

/**
 * Optional bridge FX endpoint: GET /fx/{PAIR} → { bid, ask, time }.
 * Bridges that do not implement it simply yield no rate, and the trade is
 * blocked rather than sized on an assumption.
 */
export function bridgeFxFetcher(base: string, headers: Record<string, string>): FxQuoteFetcher {
  return async (pair: string): Promise<FxQuote | null> => {
    const res = await fetch(`${base}/fx/${encodeURIComponent(pair)}`, { headers });
    if (!res.ok) return null;
    const p = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const bid = Number(p?.["bid"]);
    const ask = Number(p?.["ask"]);
    const timestamp = parseTime(p?.["time"] ?? p?.["timestamp"]);
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || !Number.isFinite(timestamp)) return null;
    return { pair, bid, ask, timestamp, source: "bridge-fx" };
  };
}

/** A fetcher that can never supply a rate — used by brokers with no FX feed. */
export const unavailableFxFetcher: FxQuoteFetcher = async () => null;
