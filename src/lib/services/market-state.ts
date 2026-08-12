// Market-state hashing.
//
// The AI is expensive and slow; running it twice on an unchanged market is
// pure waste. A state hash captures everything that could change a decision —
// candle boundary, structural events, price bucket, macro posture — so a
// repeat cycle can be answered from cache instead of the gateway.

import type { MacroReport } from "./macro.types";
import type { MultiTimeframeReport } from "./mtf";

export interface MarketStateInput {
  timeframe: string;
  /** Open time of the newest candle on the trading timeframe (UTC ms). */
  lastCandleAt: number | null;
  price: number | null;
  mtf: MultiTimeframeReport | null;
  macro: MacroReport | null;
  session: string;
}

/** Price bucket in basis points — sub-bucket drift is not a new market state. */
const PRICE_BUCKET_BPS = 8;

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function marketStateHash(i: MarketStateInput): string {
  const bucket =
    i.price == null ? "np" : Math.round(i.price / (i.price * (PRICE_BUCKET_BPS / 10_000))).toString(36);

  const events = (i.mtf?.timeframes ?? [])
    .map((t) => `${t.timeframe}:${t.bias}:${t.structure.events[0]?.type ?? "-"}${t.structure.events[0]?.direction ?? ""}`)
    .join("|");

  const macro = i.macro
    ? `${i.macro.gold_bias}:${Math.round(i.macro.news_score / 5)}:${i.macro.blackout.active ? 1 : 0}`
    : "nomacro";

  return fnv1a(
    [i.timeframe, i.lastCandleAt ?? 0, bucket, i.mtf?.verdict ?? "-", i.mtf?.alignment ?? 0, events, macro, i.session].join("~"),
  );
}

/** Small TTL cache keyed by market-state hash. */
export class StateCache<T> {
  private map = new Map<string, { at: number; value: T }>();
  constructor(private readonly ttlMs: number, private readonly maxEntries = 64) {}

  get(key: string): T | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: T): void {
    if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest) this.map.delete(oldest);
    }
    this.map.set(key, { at: Date.now(), value });
  }
}
