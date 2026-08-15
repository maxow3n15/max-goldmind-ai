import { describe, expect, it } from "vitest";
import { runSafety, type SafetyInput } from "../safety";
import { CONFIDENCE_GATES } from "../scoring";

const analysis = {
  setup: {
    direction: "BUY",
    entry: 2400,
    stop_loss: 2390,
    take_profit_1: 2430,
    risk_reward: 3,
  },
  // The model's own self-report — must never satisfy the gate on its own.
  confidence: 99,
};

function baseInput(over: Partial<SafetyInput> = {}): SafetyInput {
  return {
    analysis,
    confluence: null,
    quote: { price: 2400, bid: 2399.8, ask: 2400.2, spread: 0.4, timestamp: Date.now(), source: "live" } as any,
    connection: "connected",
    settings: {},
    snapshot: null,
    openTrades: [],
    todayTradeCount: 0,
    consecutiveLosses: 0,
    killSwitch: { active: false, reason: null },
    autoExecuteEnabled: true,
    execConnected: true,
    structuredConfidence: null,
    mtfAlignment: 80,
    ...over,
  };
}

const confidenceCheck = (report: ReturnType<typeof runSafety>) =>
  report.checks.find((c) => c.key === "confidence")!;

describe("confidence gate integrity", () => {
  it("fails closed when the deterministic engine produced no score", () => {
    const check = confidenceCheck(runSafety(baseInput()));
    expect(check.passed).toBe(false);
    expect(check.detail).toMatch(/not accepted/i);
  });

  it("never lets the AI's self-reported confidence satisfy the gate", () => {
    // analysis.confidence is 99 — well above the floor — yet with no engine
    // number the gate must still refuse.
    const check = confidenceCheck(runSafety(baseInput({ analysis: { ...analysis, confidence: 99 } })));
    expect(check.passed).toBe(false);
  });

  it("passes only on a deterministic score at or above the floor", () => {
    const pass = confidenceCheck(runSafety(baseInput({ structuredConfidence: CONFIDENCE_GATES.FINAL })));
    expect(pass.passed).toBe(true);

    const fail = confidenceCheck(runSafety(baseInput({ structuredConfidence: CONFIDENCE_GATES.FINAL - 1 })));
    expect(fail.passed).toBe(false);
  });

  it("accepts the composite score as a deterministic source", () => {
    const check = confidenceCheck(
      runSafety(baseInput({ composite: { final: CONFIDENCE_GATES.FINAL + 2, gates: [] } as any })),
    );
    expect(check.passed).toBe(true);
  });

});
