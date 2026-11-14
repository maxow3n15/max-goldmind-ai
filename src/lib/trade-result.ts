export interface ResultTrade {
  entry_price: unknown;
  exit_price: unknown;
  initial_stop_loss?: unknown;
  stop_loss?: unknown;
  take_profit_1?: unknown;
  risk_reward?: unknown;
  direction: string;
}

function finite(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Never treat a missing original stop as zero or a moved stop as original risk. */
export function tradeReturnR(trade: ResultTrade): number | null {
  const entry = finite(trade.entry_price);
  const exit = finite(trade.exit_price);
  if (entry == null || exit == null || !["BUY", "SELL"].includes(trade.direction)) return null;
  const original = finite(trade.initial_stop_loss);
  let risk = original == null ? null : Math.abs(entry - original);
  if (!risk && original == null) {
    const tp = finite(trade.take_profit_1);
    const rr = finite(trade.risk_reward);
    if (tp != null && rr != null && rr > 0) risk = Math.abs(tp - entry) / rr;
  }
  if (!risk || !Number.isFinite(risk)) return null;
  return (trade.direction === "BUY" ? exit - entry : entry - exit) / risk;
}