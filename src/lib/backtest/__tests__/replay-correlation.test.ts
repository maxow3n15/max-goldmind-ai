import { describe, expect, it } from "vitest";
import { ReplayCorrelation, CORRELATION_LOOKBACK_MS } from "../replay-correlation";

const H = 60 * 60 * 1000;

function series(start: number, closes: number[], step = H) {
  return closes.map((c, i) => ({ t: start + i * step, o: c, h: c, l: c, c, v: 1000 }));
}

describe("ReplayCorrelation", () => {
  const start = Date.UTC(2024, 0, 1);

  it("never reads a close after the bar time", () => {
    // DXY collapses far in the future; the reading at bar time must ignore it.
    const rc = new ReplayCorrelation([
      { symbol: "DX-Y.NYB", candles: series(start, [100, 100, 100, 100, 100, 1]) },
    ]);
    const at = start + 4 * H;
    expect(rc.changesAt(at)["DX-Y.NYB"]).toBe(0);
  });

  it("computes the change over the lookback window", () => {
    const rc = new ReplayCorrelation([
      { symbol: "DX-Y.NYB", candles: series(start, [100, 101, 102, 103, 104]) },
    ]);
    const at = start + 4 * H; // close 104, four hours earlier 100
    expect(rc.changesAt(at)["DX-Y.NYB"]).toBeCloseTo(4, 6);
    expect(CORRELATION_LOOKBACK_MS).toBe(4 * H);
  });

  it("drops a stale series instead of reporting a phantom reading", () => {
    const rc = new ReplayCorrelation([
      { symbol: "DX-Y.NYB", candles: series(start, [100, 101, 102, 103, 104]) },
    ]);
    const at = start + 40 * H;
    expect(rc.changesAt(at)["DX-Y.NYB"]).toBeNull();
  });

  it("marks the report degraded when nothing is measurable", () => {
    const rc = new ReplayCorrelation([]);
    const report = rc.reportAt(start, "BUY");
    expect(report.degraded).toBe(true);
  });

  it("produces a non-degraded report from real legs", () => {
    const rc = new ReplayCorrelation([
      { symbol: "DX-Y.NYB", candles: series(start, [100, 100.5, 101, 101.5, 102]) },
      { symbol: "SI=F", candles: series(start, [24, 24.1, 24.2, 24.3, 24.4]) },
    ]);
    const report = rc.reportAt(start + 4 * H, "BUY");
    expect(report.degraded).not.toBe(true);
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
  });
});
