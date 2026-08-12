// Market-data quality classification.
//
// One place decides whether the feed is good enough to trade on. Everything
// else — safety engine, UI badge, server tick — reads this verdict instead of
// re-deriving age rules, so "LIVE" means exactly the same thing everywhere.

import type { ConnectionStatus, MarketQuote } from "@/lib/market-data.types";

export type DataStatus = "LIVE" | "DELAYED" | "STALE" | "DISCONNECTED" | "SIMULATED";

export interface DataQuality {
  status: DataStatus;
  ageMs: number | null;
  /** True only for LIVE and DELAYED — the two states a real trade may use. */
  tradable: boolean;
  detail: string;
}

/** A quote older than this is delayed; older than STALE_MS it is unusable. */
export const DELAYED_MS = 10_000;
export const STALE_MS = 60_000;

export function classifyDataQuality(
  quote: (MarketQuote & { simulated?: boolean }) | null,
  connection: ConnectionStatus,
  now = Date.now(),
): DataQuality {
  if (!quote) {
    return { status: "DISCONNECTED", ageMs: null, tradable: false, detail: "No quote received" };
  }
  if (quote.simulated) {
    return {
      status: "SIMULATED",
      ageMs: now - quote.timestamp,
      tradable: false,
      detail: "Simulated prices — trading disabled",
    };
  }

  const ageMs = Math.max(0, now - quote.timestamp);
  if (connection === "disconnected" || ageMs > STALE_MS) {
    return {
      status: connection === "disconnected" ? "DISCONNECTED" : "STALE",
      ageMs,
      tradable: false,
      detail: `Last tick ${Math.round(ageMs / 1000)}s ago`,
    };
  }
  if (ageMs > DELAYED_MS || connection === "reconnecting") {
    return { status: "DELAYED", ageMs, tradable: true, detail: `Last tick ${Math.round(ageMs / 1000)}s ago` };
  }
  return { status: "LIVE", ageMs, tradable: true, detail: `${Math.round(ageMs / 1000)}s ago` };
}
