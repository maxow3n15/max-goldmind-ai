// Historical OANDA candles for pipeline replay (server-only).
//
// Yahoo gives mid-price OHLC and nothing else. OANDA gives the account's own
// bid AND ask candles, so a replay can use the spread that actually existed on
// each bar instead of one assumed constant — and the same account's margin
// rate and volume step that live execution would size against.

import type { Candle } from "@/lib/indicators";
import { validateSeries } from "@/lib/services/candle-integrity";
import type { SymbolSpec } from "@/lib/services/risk-engine";

/** App timeframe (minutes) → OANDA granularity. */
export const OANDA_GRANULARITY: Record<string, string> = {
  "5": "M5",
  "15": "M15",
  "30": "M30",
  "60": "H1",
  "240": "H4",
};

/** OANDA serves at most 5000 candles per request. */
const PAGE = 5000;

export interface OandaHistory {
  candles: Candle[];
  /** Spread in price units per bar, index-aligned with `candles`. */
  spreads: number[];
  /** Average spread over the window — used where a single figure is needed. */
  averageSpread: number;
  spec: SymbolSpec | null;
  instrument: string;
  environment: string;
}

function oandaBase(env: string) {
  return env === "live" ? "https://api-fxtrade.oanda.com" : "https://api-fxpractice.oanda.com";
}

async function getJson(url: string, token: string): Promise<any> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OANDA candles failed [${res.status}]: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

/**
 * Load bid/ask candles for the window ending now. Pages backwards from the
 * present until `days` of history are covered or the provider runs out.
 */
export async function fetchOandaHistory(opts: {
  credentials: Record<string, string>;
  environment: string;
  timeframe: string;
  days: number;
}): Promise<OandaHistory> {
  const { credentials, environment, timeframe, days } = opts;
  const token = credentials["token"] ?? "";
  if (!token) throw new Error("OANDA credentials do not contain an API token.");
  const instrument = credentials["symbol"] || "XAU_USD";
  const granularity = OANDA_GRANULARITY[timeframe];
  if (!granularity) throw new Error(`OANDA has no granularity for a ${timeframe}m timeframe.`);

  const base = oandaBase(environment);
  const from = Date.now() - days * 86_400_000;

  const raw: { t: number; o: number; h: number; l: number; c: number; v: number; spread: number }[] = [];
  let cursor = from;
  // Bounded: each page advances the cursor, and a page that adds nothing stops
  // the loop, so a stalled provider cannot spin here.
  for (let page = 0; page < 40; page++) {
    const url =
      `${base}/v3/instruments/${encodeURIComponent(instrument)}/candles` +
      `?price=BA&granularity=${granularity}&count=${PAGE}&from=${new Date(cursor).toISOString()}`;
    const json = await getJson(url, token);
    const rows: any[] = json?.candles ?? [];
    if (!rows.length) break;

    let added = 0;
    for (const r of rows) {
      if (r.complete === false) continue;
      const t = Date.parse(r.time);
      if (!Number.isFinite(t) || (raw.length && t <= raw[raw.length - 1].t)) continue;
      const bid = r.bid, ask = r.ask;
      if (!bid || !ask) continue;
      const mid = (k: "o" | "h" | "l" | "c") => (Number(bid[k]) + Number(ask[k])) / 2;
      const o = mid("o"), h = mid("h"), l = mid("l"), c = mid("c");
      if (![o, h, l, c].every(Number.isFinite)) continue;
      raw.push({
        t,
        o, h, l, c,
        v: Number(r.volume ?? 0),
        // Closing spread of the bar — what an entry at the close would pay.
        spread: Math.max(0, Number(ask.c) - Number(bid.c)),
      });
      added += 1;
    }
    const last = rows[rows.length - 1];
    const lastT = Date.parse(last?.time ?? "");
    if (!added || !Number.isFinite(lastT) || lastT <= cursor) break;
    cursor = lastT + 1;
    if (cursor >= Date.now()) break;
  }

  if (!raw.length) throw new Error("OANDA returned no candles for this instrument and window.");

  // The same integrity grading every live series passes through.
  const { candles } = validateSeries(raw.map(({ t, o, h, l, c, v }) => ({ t, o, h, l, c, v })));
  const spreadByTime = new Map(raw.map((r) => [r.t, r.spread]));
  const spreads = candles.map((c) => spreadByTime.get(c.t) ?? 0);
  const measured = spreads.filter((s) => s > 0);
  const averageSpread = measured.length
    ? measured.reduce((a, b) => a + b, 0) / measured.length
    : 0;

  let spec: SymbolSpec | null = null;
  try {
    const { getConnector } = await import("@/lib/brokers/connectors.server");
    const connector = getConnector("oanda");
    spec = (await connector.fetchSymbolSpec?.({ ...credentials, environment }, instrument)) ?? null;
  } catch {
    // Spec is an enhancement for sizing fidelity, not a requirement for data.
    spec = null;
  }

  return {
    candles,
    spreads,
    averageSpread: Number(averageSpread.toFixed(3)),
    spec,
    instrument,
    environment,
  };
}
