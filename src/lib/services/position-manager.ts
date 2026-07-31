// Autonomous position manager — pure functions that decide what to do
// with an open trade given the live price. The orchestrator calls these
// on every tick and dispatches the resulting actions through the active
// execution engine.
//
// Volatility- and momentum-aware: stop placement adapts to ATR, winners
// are held while trend strength is high, and positions are cut early when
// momentum deteriorates badly. Partial profit taking is expressed through
// the trade ladder — each leg carries its own take-profit, so a leg closing
// IS a partial exit of the overall position.

import type { Direction } from "./types";
import type { ManagementRecommendation } from "./quant.types";

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
  /** Fraction of initial risk (R) at which the stop moves to break-even. */
  breakEvenTrigger?: number;
  /** Trailing stop distance as a fraction of the initial risk (fallback). */
  trailFraction?: number;
  /** Live ATR — when present the trail is ATR-based instead of R-based. */
  atr?: number | null;
  /** Volatility/momentum-derived management plan. */
  plan?: ManagementRecommendation | null;
}

export function evaluate({
  trade,
  price,
  breakEvenTrigger,
  trailFraction = 0.5,
  atr,
  plan,
}: RulesInput): ManagementAction {
  const isBuy = trade.direction === "BUY";
  const risk = Math.abs(trade.entry_price - trade.stop_loss);
  if (!Number.isFinite(price) || price <= 0 || risk <= 0) return { type: "none" };

  const profitDistance = isBuy ? price - trade.entry_price : trade.entry_price - price;
  const rMultiple = profitDistance / risk;
  const beAtR = breakEvenTrigger ?? plan?.break_even_at_r ?? 0.5;

  // 1. Hard stop hit → close immediately.
  if (isBuy ? price <= trade.stop_loss : price >= trade.stop_loss) {
    return { type: "close", reason: "Stop loss hit", price };
  }

  // 2. Early exit when momentum has broken down and the trade is not yet
  // meaningfully in profit — better a small loss than a full stop-out.
  if (plan?.early_exit && rMultiple < 0.5) {
    return { type: "close", reason: "Early exit — momentum deteriorated", price };
  }

  // 3. Take profit. When trend strength is high and this leg has a further
  // target, let the winner run and trail instead of banking at TP1.
  if (trade.take_profit_1) {
    const hitTp1 = isBuy ? price >= trade.take_profit_1 : price <= trade.take_profit_1;
    const furtherTarget = trade.take_profit_2 ?? trade.take_profit_3 ?? null;
    if (hitTp1) {
      const runsOn = plan?.hold_winner && furtherTarget != null &&
        (isBuy ? price < furtherTarget : price > furtherTarget);
      if (!runsOn) return { type: "close", reason: "Take profit reached", price };
    }
    if (furtherTarget != null) {
      const hitFinal = isBuy ? price >= furtherTarget : price <= furtherTarget;
      if (hitFinal) return { type: "close", reason: "Extended target reached", price };
    }
  }

  // 4. Move to break-even once the trade has earned it.
  if (rMultiple >= beAtR) {
    const stopIsWorseThanEntry = isBuy
      ? trade.stop_loss < trade.entry_price
      : trade.stop_loss > trade.entry_price;
    if (stopIsWorseThanEntry) {
      return { type: "move_stop", new_stop: +trade.entry_price.toFixed(2), reason: `Move to break-even at ${beAtR}R` };
    }
  }

  // 5. Trail. ATR-based when volatility data is live (and the distance adapts
  // as volatility changes), otherwise a fixed fraction of initial risk.
  if (rMultiple >= 1) {
    const trailDistance = atr && atr > 0
      ? atr * (plan?.trail_atr_multiple ?? 1.5)
      : risk * trailFraction;
    const trailed = isBuy ? price - trailDistance : price + trailDistance;
    const improves = isBuy ? trailed > trade.stop_loss : trailed < trade.stop_loss;
    if (improves) {
      return {
        type: "move_stop",
        new_stop: +trailed.toFixed(2),
        reason: atr && atr > 0
          ? `Trail at ${(plan?.trail_atr_multiple ?? 1.5).toFixed(1)}x ATR`
          : "Trail stop",
      };
    }
  }

  return { type: "none" };
}
