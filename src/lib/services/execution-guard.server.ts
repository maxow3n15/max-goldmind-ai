// Last line of defence before a position is written.
//
// The decision pipeline runs in the browser *and* on the server, so the write
// path cannot assume the caller already applied the gates: a modified client
// could submit anything. This module re-derives the numeric gates from the
// order itself plus a freshly fetched server-side price, immediately before
// the insert. It is deliberately independent of whatever the caller computed.

import { SAFETY_CONSTANTS } from "./safety";
import { fetchSpotQuote } from "./spot.server";

export interface OrderCandidate {
  direction: "BUY" | "SELL";
  entry_price: number;
  stop_loss: number;
  take_profit_1?: number | null;
  confidence?: number | null;
}

export interface RevalidationResult {
  ok: boolean;
  reason?: string;
  /** Live server price at validation time, when one was available. */
  spot?: number | null;
}

/** Entry may not have drifted further than this from live spot. */
const MAX_ENTRY_DRIFT_PCT = 1.2;

export async function revalidateOrder(
  order: OrderCandidate,
  settings: any | null,
): Promise<RevalidationResult> {
  const minConfidence = Math.max(
    SAFETY_CONSTANTS.MIN_CONFIDENCE,
    Number(settings?.min_confidence ?? 0) || 0,
  );
  const minRr = Math.max(
    SAFETY_CONSTANTS.MIN_RR,
    Number(settings?.min_risk_reward ?? 0) || 0,
  );
  const maxSpread = Number(settings?.max_spread ?? SAFETY_CONSTANTS.MAX_SPREAD) || SAFETY_CONSTANTS.MAX_SPREAD;

  const confidence = Number(order.confidence ?? 0);
  if (!(confidence >= minConfidence)) {
    return { ok: false, reason: `Confidence ${confidence.toFixed(0)}% is below the ${minConfidence}% floor.` };
  }

  const wrongSide =
    order.direction === "BUY" ? order.stop_loss >= order.entry_price : order.stop_loss <= order.entry_price;
  if (wrongSide) return { ok: false, reason: "Stop loss is on the wrong side of entry." };

  const risk = Math.abs(order.entry_price - order.stop_loss);
  if (!(risk > 0)) return { ok: false, reason: "Zero stop distance." };

  if (order.take_profit_1 != null) {
    const rr = Math.abs(order.take_profit_1 - order.entry_price) / risk;
    if (rr < minRr) return { ok: false, reason: `Risk/reward ${rr.toFixed(2)} is below ${minRr}.` };
  }

  const quote = await fetchSpotQuote();
  if (!quote) return { ok: false, reason: "No live server-side price — execution refused." };

  if (Date.now() - quote.timestamp > 60_000) {
    return { ok: false, reason: "Server price is stale — execution refused.", spot: quote.mid };
  }
  if (quote.spread > maxSpread) {
    return { ok: false, reason: `Spread ${quote.spread.toFixed(2)} exceeds ${maxSpread}.`, spot: quote.mid };
  }

  const driftPct = (Math.abs(order.entry_price - quote.mid) / quote.mid) * 100;
  if (driftPct > MAX_ENTRY_DRIFT_PCT) {
    return {
      ok: false,
      reason: `Price moved ${driftPct.toFixed(2)}% away from the planned entry — setup expired.`,
      spot: quote.mid,
    };
  }

  return { ok: true, spot: quote.mid };
}
