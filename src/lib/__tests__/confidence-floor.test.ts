import { describe, it, expect } from "vitest";
import { effectiveConfidenceFloor } from "@/lib/services/confidence-floor";

describe("dual confidence gate", () => {
  it("real-money live stays at 88% even with a 70% demo floor", () => {
    expect(effectiveConfidenceFloor({ tradingMode: "live", brokerIsDemo: false, demoFloor: 70 })).toBe(88);
  });
  it("unknown broker environment is treated as real money", () => {
    expect(effectiveConfidenceFloor({ tradingMode: "live", brokerIsDemo: null, demoFloor: 70 })).toBe(88);
  });
  it("demo broker uses the 70% demo floor", () => {
    expect(effectiveConfidenceFloor({ tradingMode: "live", brokerIsDemo: true, demoFloor: 70 })).toBe(70);
  });
  it("paper uses the demo floor; unset defaults to 88", () => {
    expect(effectiveConfidenceFloor({ tradingMode: "paper", brokerIsDemo: null, demoFloor: 70 })).toBe(70);
    expect(effectiveConfidenceFloor({ tradingMode: "paper", brokerIsDemo: null, demoFloor: null })).toBe(88);
  });
});
