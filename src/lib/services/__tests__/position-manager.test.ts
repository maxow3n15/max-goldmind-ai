import { describe, it, expect } from "vitest";
import { evaluate, initialRisk, type OpenTrade } from "@/lib/services/position-manager";

const base: OpenTrade = {
  id: "t1",
  direction: "BUY",
  entry_price: 2000,
  stop_loss: 1990,
  initial_stop_loss: 1990,
  take_profit_1: 2030,
  take_profit_2: null,
  take_profit_3: null,
  lot_size: 0.1,
  opened_at: new Date().toISOString(),
};

describe("position manager R anchoring", () => {
  it("measures risk from the opening stop, not the moved stop", () => {
    expect(initialRisk({ ...base, stop_loss: 2000 })).toBe(10);
    expect(initialRisk({ ...base, stop_loss: 2005 })).toBe(10);
  });

  it("falls back to the current stop for legacy rows", () => {
    expect(initialRisk({ ...base, initial_stop_loss: null })).toBe(10);
  });

  it("moves to break-even with a buffer beyond entry", () => {
    const a = evaluate({ trade: base, price: 2005 });
    expect(a.type).toBe("move_stop");
    if (a.type === "move_stop") {
      expect(a.new_stop).toBeGreaterThan(base.entry_price);
      expect(a.new_stop).toBeCloseTo(2000.5, 2);
    }
  });

  it("keeps trailing after break-even instead of freezing", () => {
    const protectedTrade = { ...base, stop_loss: 2000.5 };
    const a = evaluate({ trade: protectedTrade, price: 2012 });
    expect(a.type).toBe("move_stop");
    if (a.type === "move_stop") expect(a.new_stop).toBeGreaterThan(2000.5);
  });

  it("does not step the trail back down to break-even", () => {
    const trailing = { ...base, stop_loss: 2007 };
    const a = evaluate({ trade: trailing, price: 2012 });
    expect(a.type === "none" || (a.type === "move_stop" && a.new_stop > 2007)).toBe(true);
  });

  it("still closes on stop and target when initial risk is unusable", () => {
    const frozen = { ...base, stop_loss: 2000, initial_stop_loss: 2000 };
    expect(initialRisk(frozen)).toBe(0);
    expect(evaluate({ trade: frozen, price: 1999 }).type).toBe("close");
    expect(evaluate({ trade: frozen, price: 2031 }).type).toBe("close");
    expect(evaluate({ trade: frozen, price: 2010 }).type).toBe("none");
  });

  it("applies the same anchoring for sells", () => {
    const sell: OpenTrade = { ...base, direction: "SELL", stop_loss: 2010, initial_stop_loss: 2010, take_profit_1: 1970 };
    const be = evaluate({ trade: sell, price: 1995 });
    expect(be.type).toBe("move_stop");
    if (be.type === "move_stop") expect(be.new_stop).toBeLessThan(2000);
    const trail = evaluate({ trade: { ...sell, stop_loss: 1999.5 }, price: 1988 });
    expect(trail.type).toBe("move_stop");
    if (trail.type === "move_stop") expect(trail.new_stop).toBeLessThan(1999.5);
  });
});
