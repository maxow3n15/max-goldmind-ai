// Effective confidence floor, by execution environment.
//
// Real-money live trading is hard-locked to CONFIDENCE_GATES.FINAL (88%) —
// no setting, caller or environment can lower it. Paper trading and verified
// demo/practice broker accounts may use a lower, user-configured floor so the
// strategy can be forward-tested on demo without touching the live gate.
//
// Pure and shared: the browser engine, the server tick and the execution
// guards all derive the floor through this one function.

import { CONFIDENCE_GATES } from "./scoring";

/** Lowest floor a user may configure for demo/paper forward testing. */
export const DEMO_FLOOR_MIN = 50;

export interface ConfidenceFloorInput {
  tradingMode: "paper" | "live";
  /**
   * True only when the broker connection was positively resolved server-side
   * as a demo/practice environment. Null (unknown/unresolved) is treated as
   * real money — the safe direction.
   */
  brokerIsDemo: boolean | null;
  /** The user's configured demo floor (user_settings.demo_confidence_floor). */
  demoFloor: number | null | undefined;
}

export function effectiveConfidenceFloor(i: ConfidenceFloorInput): number {
  // Real money (or anything we cannot prove is demo): the live gate, always.
  if (i.tradingMode === "live" && i.brokerIsDemo !== true) return CONFIDENCE_GATES.FINAL;

  if (i.demoFloor === null || i.demoFloor === undefined) return CONFIDENCE_GATES.FINAL;
  const raw = Number(i.demoFloor);
  if (!Number.isFinite(raw)) return CONFIDENCE_GATES.FINAL;
  // The demo floor may lower the gate for forward testing but never raise it
  // above the live standard, and never below the research minimum.
  return Math.max(DEMO_FLOOR_MIN, Math.min(CONFIDENCE_GATES.FINAL, Math.round(raw)));
}
