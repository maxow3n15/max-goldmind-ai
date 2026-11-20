import { describe, it, expect } from "vitest";
import { buildSwingCandidate, evaluateSwingPosition, SWING_POLICY } from "../swing";

const H = 3600_000;
const now = Date.UTC(2026, 10, 18, 12);
const meta = { version: "swing-v1", setupId: "x", firstTarget: 2700, maxHoldHours: 96 };
const trade = (over: any = {}) => ({ id: "t", direction: "BUY", entry_price: 2650, stop_loss: 2638, initial_stop_loss: 2638,
  take_profit_1: 2710, take_profit_2: null, take_profit_3: null, lot_size: 1, opened_at: new Date(now - 10 * H).toISOString(), swing: meta, ...over }) as any;

describe("swing policy", () => {
  it("requires at least 2R and holds up to 4 days", () => {
    expect(SWING_POLICY.minRr).toBe(2);
    expect(SWING_POLICY.maxHoldHours).toBe(96);
  });
  it("refuses to trade without Daily, 4H and 1H evidence", () => {
    expect(buildSwingCandidate(null, 2650, [], now).setup).toBeNull();
  });
  it("keeps a trade open overnight while price is between stop and target", () => {
    expect(evaluateSwingPosition(trade(), 2660, null, now).type).toBe("none");
  });
  it("closes after 96 hours", () => {
    const a = evaluateSwingPosition(trade({ opened_at: new Date(now - 97 * H).toISOString() }), 2660, null, now);
    expect(a.type).toBe("close");
  });
  it("closes when the structural stop is hit", () => {
    expect(evaluateSwingPosition(trade(), 2637, null, now).type).toBe("close");
  });
  it("moves the stop to break-even after the first target", () => {
    const a: any = evaluateSwingPosition(trade(), 2701, null, now);
    expect(a.type).toBe("move_stop");
    expect(a.new_stop).toBeCloseTo(2650.6, 1);
  });
});
