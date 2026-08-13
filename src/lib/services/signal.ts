// Signal lifetime and paper-fill modelling.
//
// A setup is a statement about the market at one instant. Gold moves; a plan
// computed three minutes ago is no longer the plan the engine reasoned about,
// so every plan carries an explicit expiry and nothing may execute past it.
//
// The fill model lives here too: paper trading is only useful if it fills at a
// price a broker could plausibly have given, not at the idealised plan price.

import type { Direction } from "./types";

/** Default life of a generated setup. Short by design. */
export const SIGNAL_TTL_MS = 180_000;

/** Assumed adverse slippage on a market order, in USD per ounce. */
export const ASSUMED_SLIPPAGE_USD = 0.05;

export interface SignalWindow {
  issued_at: number;
  expires_at: number;
}

export function signalWindow(now = Date.now(), ttlMs = SIGNAL_TTL_MS): SignalWindow {
  return { issued_at: now, expires_at: now + Math.max(1_000, ttlMs) };
}

export function isExpired(expiresAt: number | null | undefined, now = Date.now()): boolean {
  if (expiresAt == null || !Number.isFinite(expiresAt)) return false;
  return now > expiresAt;
}

export interface FillInput {
  direction: Direction;
  /** Mid price the server observed at execution time. */
  mid: number;
  /** Full bid/ask spread at execution time. */
  spread: number;
  slippage?: number;
}

export interface Fill {
  price: number;
  /** Cost of crossing the spread plus assumed slippage, in USD per ounce. */
  cost: number;
}

/**
 * A BUY pays the ask and slips up; a SELL receives the bid and slips down.
 * Deterministic — no randomness, so a replay of the same inputs fills the
 * same way and backtests stay reproducible.
 */
export function modelFill(i: FillInput): Fill {
  const half = Math.max(0, Number(i.spread) || 0) / 2;
  const slip = i.slippage ?? ASSUMED_SLIPPAGE_USD;
  const cost = half + slip;
  const price = i.direction === "BUY" ? i.mid + cost : i.mid - cost;
  return { price: +price.toFixed(3), cost: +cost.toFixed(3) };
}
