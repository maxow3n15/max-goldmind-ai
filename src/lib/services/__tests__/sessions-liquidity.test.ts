import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/indicators";
import { readSessionLiquidity, sessionsAt } from "../sessions-liquidity";

const DAY = Date.UTC(2026, 4, 6); // Wednesday

/** One candle per hour across the UTC day, with explicit highs/lows. */
function hourly(spec: { hour: number; h: number; l: number; c?: number }[]): Candle[] {
  return spec.map((s) => ({
    t: DAY + s.hour * 3_600_000,
    o: s.l,
    h: s.h,
    l: s.l,
    c: s.c ?? (s.h + s.l) / 2,
    v: 100,
  }));
}

describe("session windows", () => {
  it("identifies the London/New York overlap", () => {
    const keys = sessionsAt(DAY + 14 * 3_600_000).map((w) => w.key);
    expect(keys).toContain("london");
    expect(keys).toContain("newyork");
  });

  it("returns no session outside every window", () => {
    expect(sessionsAt(DAY + 22 * 3_600_000)).toHaveLength(0);
  });
});

describe("session liquidity read", () => {
  const candles = hourly([
    { hour: 1, h: 2410, l: 2400 },   // Asian
    { hour: 4, h: 2415, l: 2405 },   // Asian high 2415, low 2400
    { hour: 9, h: 2420, l: 2408 },   // London
    { hour: 13, h: 2418, l: 2395, c: 2412 }, // NY: takes the Asian low
  ]);

  it("computes each session range from its own candles", () => {
    const r = readSessionLiquidity({ intraday: candles, now: DAY + 15 * 3_600_000 });
    const asian = r.sessions.find((s) => s.key === "asian")!;
    expect(asian.high).toBe(2415);
    expect(asian.low).toBe(2400);
    expect(asian.range).toBe(15);
  });

  it("marks the Asian low as swept and reclaimed after the NY run", () => {
    const r = readSessionLiquidity({ intraday: candles, now: DAY + 15 * 3_600_000 });
    const asian = r.sessions.find((s) => s.key === "asian")!;
    expect(asian.lowSwept).toBe(true);
    const sweep = r.sweeps.find((s) => s.label === "Asian session low");
    expect(sweep).toBeDefined();
    expect(sweep!.penetration).toBe(5);
    expect(sweep!.reclaimed).toBe(true);
  });

  it("does not treat a session's own candles as sweeping its own high", () => {
    const r = readSessionLiquidity({ intraday: candles, now: DAY + 5 * 3_600_000 });
    const asian = r.sessions.find((s) => s.key === "asian")!;
    expect(asian.highSwept).toBe(false);
  });

  it("degrades cleanly with no candles", () => {
    const r = readSessionLiquidity({ intraday: [], now: DAY + 10 * 3_600_000 });
    expect(r.sessions).toHaveLength(0);
    expect(r.sweeps).toHaveLength(0);
  });
});
