import { describe, it, expect } from "vitest";
import { deriveArming, deriveState, type ArmingRequirement } from "../execution-state";

const ok = (key: string): ArmingRequirement => ({ key, label: key, ok: true });
const bad = (key: string, detail: string): ArmingRequirement => ({ key, label: key, ok: false, detail });

describe("arming state", () => {
  it("arms practice when every requirement passes", () => {
    const r = deriveArming({ autoExecute: true, realMoney: false, adminLocked: true, requirements: [ok("a"), ok("b")] });
    expect(r.arming).toBe("ARMED_PRACTICE");
    expect(r.blocking).toEqual([]);
  });

  it("keeps real money locked even when everything else passes", () => {
    const r = deriveArming({ autoExecute: true, realMoney: true, adminLocked: true, requirements: [ok("a")] });
    expect(r.arming).toBe("ARMED_LIVE_LOCKED");
  });

  it("disarms and reports the blocking reason", () => {
    const r = deriveArming({
      autoExecute: true,
      realMoney: false,
      adminLocked: true,
      requirements: [ok("a"), bad("daily_loss", "Daily loss limit reached")],
    });
    expect(r.arming).toBe("DISARMED");
    expect(r.blocking).toEqual(["Daily loss limit reached"]);
  });

  it("disarms when auto-execution is off", () => {
    const r = deriveArming({ autoExecute: false, realMoney: false, adminLocked: true, requirements: [ok("a")] });
    expect(r.arming).toBe("DISARMED");
  });
});

describe("execution state", () => {
  const base = {
    arming: "ARMED_PRACTICE" as const,
    killSwitch: false,
    adminLockedRealMoney: false,
    brokerConnected: true,
    openTrades: 0,
    reconciliationRequired: 0,
  };

  it("kill switch wins over everything", () => {
    expect(deriveState({ ...base, killSwitch: true, openTrades: 3 })).toBe("KILL_SWITCH");
  });

  it("unresolved reconciliation reports FAILED", () => {
    expect(deriveState({ ...base, reconciliationRequired: 1, openTrades: 2 })).toBe("FAILED");
  });

  it("monitors while positions are open", () => {
    expect(deriveState({ ...base, openTrades: 1 })).toBe("MONITORING");
  });

  it("armed when idle and armed", () => {
    expect(deriveState(base)).toBe("ARMED");
  });

  it("disconnected broker overrides armed", () => {
    expect(deriveState({ ...base, brokerConnected: false })).toBe("DISCONNECTED");
  });
});
