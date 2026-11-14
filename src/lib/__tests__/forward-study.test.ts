import { describe, expect, it } from "vitest";
import { studyExecutionBlock, studyStats, STUDY_FLOOR } from "../forward-study";
import { effectiveConfidenceFloor } from "../services/confidence-floor";

const study = { id: "study", broker_connection_id: "demo", status: "active" };
const input = { connectionId: "demo", brokerId: "oanda", environment: "oanda_practice", brokerIsDemo: true, tradingMode: "live", requestedStudyId: "study" };
describe("88% OANDA forward study", () => {
  it("uses 88 even with a 70% demo setting", () => {
    expect(effectiveConfidenceFloor({ tradingMode: "live", brokerIsDemo: true, demoFloor: 70, studyOpen: true })).toBe(88);
    expect(STUDY_FLOOR).toBe(88);
  });
  it("keeps real money at 88 outside a study", () => {
    expect(effectiveConfidenceFloor({ tradingMode: "live", brokerIsDemo: false, demoFloor: 70 })).toBe(88);
  });
  it("allows only the pinned verified OANDA practice scheduler", () => { expect(studyExecutionBlock(study, input)).toBeNull(); });
  it("rejects non-demo", () => { expect(studyExecutionBlock(study, { ...input, brokerIsDemo: false })).not.toBeNull(); });
  it("rejects unknown environment", () => { expect(studyExecutionBlock(study, { ...input, environment: null })).not.toBeNull(); });
  it("rejects a different account", () => { expect(studyExecutionBlock(study, { ...input, connectionId: "other" })).not.toBeNull(); });
  it("rejects browser automation without a study ID", () => { expect(studyExecutionBlock(study, { ...input, requestedStudyId: null })).not.toBeNull(); });
  it("blocks entries while paused", () => { expect(studyExecutionBlock({ ...study, status: "paused" }, input)).not.toBeNull(); });
  it("rejects paper mode", () => { expect(studyExecutionBlock(study, { ...input, tradingMode: "paper" })).not.toBeNull(); });
  it("aggregates closed results, not open trades", () => {
    const base = { direction: "BUY", entry_price: 2600, initial_stop_loss: 2590 };
    const stats = studyStats([{ ...base, exit_price: 2620, status: "closed", pnl: 20 }, { ...base, exit_price: 2590, status: "closed", pnl: -10 }, { ...base, exit_price: 2630, status: "open", pnl: 30 }]);
    expect(stats.closed).toBe(2); expect(stats.winRate).toBe(50); expect(stats.netPnl).toBe(10); expect(stats.expectancyR).toBe(0.5); expect(stats.sufficientSample).toBe(false);
  });
  it("requires 30 measurable closed trades, not 30 missing risk records", () => {
    const valid = { direction: "BUY", entry_price: 2600, initial_stop_loss: 2590, exit_price: 2610, status: "closed", pnl: 10 };
    expect(studyStats(Array.from({ length: 29 }, () => valid)).sufficientSample).toBe(false);
    expect(studyStats(Array.from({ length: 30 }, () => valid)).sufficientSample).toBe(true);
    expect(studyStats(Array.from({ length: 30 }, () => ({ ...valid, initial_stop_loss: null }))).sufficientSample).toBe(false);
  });
});