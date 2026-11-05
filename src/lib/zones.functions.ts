import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildMarketStructure } from "@/lib/mtf.server";

export interface ActiveZone {
  kind: "Order block" | "Breaker" | "FVG";
  direction: "bullish" | "bearish";
  timeframe: string;
  top: number;
  bottom: number;
  /** Distance from live price to the nearest edge of the zone, in $. 0 = price inside. */
  distUsd: number;
  /** Same distance expressed in ATRs of that timeframe. */
  distAtr: number | null;
}

const TIMEFRAMES: { key: string; label: string }[] = [
  { key: "15", label: "15m" },
  { key: "60", label: "1H" },
  { key: "240", label: "4H" },
];

const MAX_ZONES = 12;

/**
 * Unmitigated order blocks, breaker blocks and fair value gaps across the
 * trading timeframes, sorted by distance from the live price. Structure is
 * rebuilt from the same cached candle series the decision engine uses, so the
 * zones shown here are exactly the ones the AI is reasoning about.
 */
export const getActiveZones = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ zones: ActiveZone[]; price: number | null; generated_at: number }> => {
    const zones: ActiveZone[] = [];
    let price: number | null = null;

    for (const tf of TIMEFRAMES) {
      try {
        const bundle = await buildMarketStructure(tf.key);
        const s = bundle.entryStructure;
        const p = s.lastPrice;
        if (p != null && (price == null || tf.key === "15")) price = p;
        if (p == null) continue;
        const atr = s.atr && s.atr > 0 ? s.atr : null;

        const push = (kind: ActiveZone["kind"], direction: "bullish" | "bearish", top: number, bottom: number) => {
          const distUsd = p > top ? p - top : p < bottom ? bottom - p : 0;
          zones.push({
            kind,
            direction,
            timeframe: tf.label,
            top,
            bottom,
            distUsd: Math.round(distUsd * 100) / 100,
            distAtr: atr ? Math.round((distUsd / atr) * 100) / 100 : null,
          });
        };

        for (const ob of s.orderBlocks) if (!ob.mitigated) push("Order block", ob.direction, ob.top, ob.bottom);
        for (const b of s.breakers) if (!b.retested) push("Breaker", b.direction, b.top, b.bottom);
        for (const f of s.fvgs) if (!f.mitigated) push("FVG", f.direction, f.top, f.bottom);
      } catch {
        // A timeframe feed hiccup must not blank the whole card.
      }
    }

    zones.sort((a, b) => a.distUsd - b.distUsd);
    return { zones: zones.slice(0, MAX_ZONES), price, generated_at: Date.now() };
  });
