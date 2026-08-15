import { describe, expect, it } from "vitest";
import { clampConfidence, validateSetup } from "../setup-validation";

const SPOT = 2400;
const good = {
  direction: "BUY",
  entry: 2400,
  stop_loss: 2390,
  take_profit_1: 2420,
  take_profit_2: 2440,
  take_profit_3: 2460,
  risk_reward: 99,
};

describe("AI setup schema validation", () => {
  it("accepts a coherent setup and recomputes risk:reward itself", () => {
    const { setup } = validateSetup(good, SPOT);
    expect(setup?.direction).toBe("BUY");
    // 20 reward / 10 risk — the model's fabricated 99 is discarded.
    expect(setup?.risk_reward).toBe(2);
  });

  it("rejects a BUY whose stop sits above entry", () => {
    const { setup, rejections } = validateSetup({ ...good, stop_loss: 2410 }, SPOT);
    expect(setup).toBeNull();
    expect(rejections[0]).toMatch(/wrong side/i);
  });

  it("rejects a SELL whose targets are above entry", () => {
    const { setup } = validateSetup(
      { direction: "SELL", entry: 2400, stop_loss: 2410, take_profit_1: 2420 },
      SPOT,
    );
    expect(setup).toBeNull();
  });

  it("rejects a direction that is neither BUY nor SELL", () => {
    expect(validateSetup({ ...good, direction: "HOLD" }, SPOT).setup).toBeNull();
  });

  it("rejects non-numeric entry or stop", () => {
    expect(validateSetup({ ...good, entry: "somewhere near 2400" }, SPOT).setup).toBeNull();
  });

  it("rejects an entry that has drifted too far from spot to be tradeable", () => {
    expect(validateSetup({ ...good, entry: 2300, stop_loss: 2290, take_profit_1: 2330 }, SPOT).setup).toBeNull();
  });

  it("rejects stops inside spread noise and implausibly wide stops", () => {
    expect(validateSetup({ ...good, stop_loss: 2399.9 }, SPOT).setup).toBeNull();
    expect(validateSetup({ ...good, stop_loss: 2300 }, SPOT).setup).toBeNull();
  });

  it("rejects a setup whose nearest target pays less than 1R", () => {
    expect(validateSetup({ ...good, take_profit_1: 2405, take_profit_2: null, take_profit_3: null }, SPOT).setup)
      .toBeNull();
  });

  it("clamps confidence into 0-100 and treats junk as zero", () => {
    expect(clampConfidence(150)).toBe(100);
    expect(clampConfidence(-10)).toBe(0);
    expect(clampConfidence("not a number")).toBe(0);
  });
});
