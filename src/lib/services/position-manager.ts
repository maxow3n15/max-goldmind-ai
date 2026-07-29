// Autonomous position manager — pure functions that decide what to do
// with an open trade given the live price. The orchestrator calls these
// on every tick and dispatches the resulting actions through the active
// execution engine.

import type { Direction } from "./types";

export interface OpenTrade {
  id: string;
  direction: Direction;
  entry_price: number;
  stop_loss: number;
  take_profit_1: number | null;
  take_profit_2: number | null;
  take_profit_3: number | null;
  lot_size: number;
  opened_at: string;
}

export type ManagementAction =
  | { type: "close"; reason: string; price: number }
  | { type: "move_stop"; new_stop: number; reason: string }
  | { type: "none" };

interface RulesInput {
  trade: OpenTrade;
  price: number;
  // Fractional progress toward TP1 that triggers move-to-BE (e.g. 0.5 = 50%).
  breakEvenTrigger?: number;
  // Trailing stop distance expressed as a fraction of the initial risk.
  trailFraction?: number;
}

export function evaluate({
  trade,
  price,
  breakEvenTrigger = 0.5,
  trailFraction = 0.5,
}: RulesInput): ManagementAction {
  const isBuy = trade.direction === "BUY";
  const risk = Math.abs(trade.entry_price - trade.stop_loss);
  if (!Number.isFinite(price) || price <= 0 || risk <= 0) return { type: "none" };

  // 1. Hard stop hit → close immediately.
  if (isBuy ? price <= trade.stop_loss : price >= trade.stop_loss) {
    return { type: "close", reason: "Stop loss hit", price };
  }
  // 2. TP1 hit → close (paper engine takes the full position; a real engine
  // would scale out).
  if (trade.take_profit_1) {
    if (isBuy ? price >= trade.take_profit_1 : price <= trade.take_profit_1) {
      return { type: "close", reason: "TP1 reached", price };
    }
  }

  // 3. Move to break-even when price has moved `breakEvenTrigger` of the
  // way toward TP1 and the stop is still worse than entry.
  if (trade.take_profit_1) {
    const target = trade.take_profit_1;
    const progress = isBuy
      ? (price - trade.entry_price) / (target - trade.entry_price)
      : (trade.entry_price - price) / (trade.entry_price - target);
    if (progress >= breakEvenTrigger) {
      const stopIsWorseThanEntry = isBuy
        ? trade.stop_loss < trade.entry_price
        : trade.stop_loss > trade.entry_price;
      if (stopIsWorseThanEntry) {
        return { type: "move_stop", new_stop: trade.entry_price, reason: "Move to break-even" };
      }
    }
  }

  // 4. Trail: once past 1R in profit, keep stop at (price - trailFraction*risk).
  const profitDistance = isBuy ? price - trade.entry_price : trade.entry_price - price;
  if (profitDistance >= risk) {
    const trailed = isBuy ? price - risk * trailFraction : price + risk * trailFraction;
    const improves = isBuy ? trailed > trade.stop_loss : trailed < trade.stop_loss;
    if (improves) return { type: "move_stop", new_stop: +trailed.toFixed(2), reason: "Trail stop" };
  }

  return { type: "none" };
}
