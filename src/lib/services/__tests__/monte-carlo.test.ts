import { describe, expect, it } from "vitest";
import { buildWalkForwardWindows, runMonteCarlo, runWalkForward } from "../monte-carlo";

const edge = [2, -1, -1, 2, -1, 3, -1, -1, 2, -1, 1.5, -1, 2, -1, -1, 2.5, -1, 1, -1, 2];
const losing = edge.map((r) => (r > 0 ? 0.4 : -1));

describe("monte carlo", () => {
  it("returns null without enough trades", () => {
    expect(runMonteCarlo({ rMultiples: [1, -1], riskFraction: 0.005 })).toBeNull();
  });

  it("is deterministic for a given seed", () => {
    const a = runMonteCarlo({ rMultiples: edge, riskFraction: 0.005, seed: 7, iterations: 400 });
    const b = runMonteCarlo({ rMultiples: edge, riskFraction: 0.005, seed: 7, iterations: 400 });
    expect(a).toEqual(b);
  });

  it("reports a positive median for a positive-expectancy series", () => {
    const r = runMonteCarlo({ rMultiples: edge, riskFraction: 0.005, seed: 1, iterations: 800 })!;
    expect(r.finalEquity.median).toBeGreaterThan(1);
    expect(r.riskOfRuinPct).toBe(0);
    expect(r.drawdown.p95).toBeGreaterThanOrEqual(r.drawdown.median);
  });

  it("shows worse outcomes for a negative-expectancy series", () => {
    const good = runMonteCarlo({ rMultiples: edge, riskFraction: 0.005, seed: 1, iterations: 800 })!;
    const bad = runMonteCarlo({ rMultiples: losing, riskFraction: 0.005, seed: 1, iterations: 800 })!;
    expect(bad.finalEquity.median).toBeLessThan(good.finalEquity.median);
    expect(bad.drawdown.median).toBeGreaterThan(good.drawdown.median);
  });
});

describe("walk forward", () => {
  it("never overlaps train and test within a fold", () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const w = buildWalkForwardWindows(items, { trainSize: 8, testSize: 4 });
    expect(w.length).toBeGreaterThan(0);
    for (const f of w) expect(f.train.filter((x) => f.test.includes(x))).toHaveLength(0);
  });

  it("returns null when there is not enough history", () => {
    expect(runWalkForward([1, -1, 1], { trainSize: 8, testSize: 4 })).toBeNull();
  });

  it("summarises out-of-sample efficiency", () => {
    const rs = [...edge, ...edge, ...edge];
    const r = runWalkForward(rs, { trainSize: 20, testSize: 10 })!;
    expect(r.folds.length).toBeGreaterThan(0);
    expect(r.positiveFoldsPct).toBeGreaterThan(0);
  });
});
