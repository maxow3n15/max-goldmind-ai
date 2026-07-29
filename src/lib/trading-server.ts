// Service layer stub for a future external trading server.
//
// The frontend must NEVER talk to a broker or MT5 directly. All broker-side
// concerns (live prices, order routing, positions, confirmations) go through
// this typed client, which hits a backend URL configured via env.
//
// Nothing here executes real trades today — the methods return typed empty
// results so the UI can be wired up now and swapped to real endpoints later
// without any component changes.

import type {
  MarketQuote,
  RemotePosition,
  TradingSignal,
} from "./market-data.types";

const BASE_URL: string | undefined = import.meta.env.VITE_TRADING_SERVER_URL;

export function isTradingServerConfigured(): boolean {
  return typeof BASE_URL === "string" && BASE_URL.length > 0;
}

async function getJson<T>(path: string): Promise<T | null> {
  if (!BASE_URL) return null;
  try {
    const res = await fetch(`${BASE_URL}${path}`, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export const tradingServer = {
  async getQuote(): Promise<MarketQuote | null> {
    return getJson<MarketQuote>("/market/xauusd");
  },
  async getSignals(): Promise<TradingSignal[]> {
    return (await getJson<TradingSignal[]>("/signals")) ?? [];
  },
  async getOpenPositions(): Promise<RemotePosition[]> {
    return (await getJson<RemotePosition[]>("/positions/open")) ?? [];
  },
  async getClosedPositions(): Promise<RemotePosition[]> {
    return (await getJson<RemotePosition[]>("/positions/closed")) ?? [];
  },
  async getAccount(): Promise<Record<string, unknown> | null> {
    return getJson<Record<string, unknown>>("/account");
  },
};
