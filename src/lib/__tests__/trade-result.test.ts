import { describe, expect, it } from "vitest";
import { tradeReturnR } from "../trade-result";

describe("original planned risk", () => {
  it("returns -1R at the original stop for a buy", () => {
    expect(tradeReturnR({ direction: "BUY", entry_price: 2600, exit_price: 2590, initial_stop_loss: 2590 })).toBe(-1);
  });
  it("returns -1R at the original stop for a sell", () => {
    expect(tradeReturnR({ direction: "SELL", entry_price: 2600, exit_price: 2610, initial_stop_loss: 2610 })).toBe(-1);
  });
  it("preserves losses beyond planned risk", () => {
    expect(tradeReturnR({ direction: "BUY", entry_price: 2600, exit_price: 2585, initial_stop_loss: 2590 })).toBe(-1.5);
  });
  it("ignores a stop moved to entry", () => {
    expect(tradeReturnR({ direction: "BUY", entry_price: 2600, exit_price: 2620, initial_stop_loss: 2590, stop_loss: 2600 })).toBe(2);
  });
  it("does not manufacture risk from null original stops", () => {
    expect(tradeReturnR({ direction: "BUY", entry_price: 2600, exit_price: 2620, initial_stop_loss: null, stop_loss: 2600 })).toBeNull();
  });
  it("reconstructs documented planned risk from target and planned RR", () => {
    expect(tradeReturnR({ direction: "SELL", entry_price: 2600, exit_price: 2580, initial_stop_loss: null, take_profit_1: 2580, risk_reward: 2 })).toBe(2);
  });
});