import { describe, expect, it } from "vitest";
import { validateSeries, isValidCandle, worstStatus } from "../candle-integrity";
import { modelFill, isExpired, signalWindow } from "../signal";

const bar = (t: number, o: number, h: number, l: number, c: number) => ({ t, o, h, l, c, v: 1 });
const series = (n: number, start = 1_700_000_000_000) =>
  Array.from({ length: n }, (_, i) => bar(start + i * 60_000, 2600, 2602, 2598, 2601));

describe("candle integrity", () => {
  it("rejects impossible bars", () => {
    expect(isValidCandle(bar(1, 10, 5, 8, 9))).toBe(false);     // high < low
    expect(isValidCandle(bar(1, 100, 10, 5, 9))).toBe(false);   // open outside range
    expect(isValidCandle(bar(1, 8, 10, 5, 9))).toBe(true);
  });

  it("drops impossible bars and flags the series as degraded", () => {
    const raw = [...series(30), bar(1_700_000_000_000 + 31 * 60_000, 10, 5, 8, 9)];
    const { candles, report } = validateSeries(raw);
    expect(report.impossible).toBe(1);
    expect(candles).toHaveLength(30);
    expect(report.status).toBe("DEGRADED");
  });

  it("collapses duplicate timestamps and re-sorts", () => {
    const base = series(30);
    const raw = [...base, base[10], base[5]];
    const { candles, report } = validateSeries(raw);
    expect(report.duplicates).toBe(2);
    expect(candles).toHaveLength(30);
    expect(candles.every((c, i) => i === 0 || c.t > candles[i - 1].t)).toBe(true);
  });

  it("counts missing bars against the modal spacing", () => {
    const base = series(30);
    const raw = [...base.slice(0, 10), ...base.slice(13)];
    expect(validateSeries(raw).report.gaps).toBe(3);
  });

  it("marks too-short series as invalid", () => {
    expect(validateSeries(series(5)).report.status).toBe("INVALID");
    expect(validateSeries([]).report.status).toBe("INVALID");
  });

  it("passes a clean series", () => {
    expect(validateSeries(series(60)).report.status).toBe("OK");
  });

  it("takes the worst status across timeframes", () => {
    expect(worstStatus(["OK", "DEGRADED", "INVALID"])).toBe("INVALID");
    expect(worstStatus(["OK", "DEGRADED"])).toBe("DEGRADED");
    expect(worstStatus(["OK", "OK"])).toBe("OK");
  });
});

describe("signal lifetime and fills", () => {
  it("expires a plan past its window", () => {
    const w = signalWindow(1000, 5000);
    expect(isExpired(w.expires_at, 5000)).toBe(false);
    expect(isExpired(w.expires_at, 6001)).toBe(true);
    expect(isExpired(null, 9e12)).toBe(false);
  });

  it("fills a BUY above and a SELL below the mid", () => {
    const buy = modelFill({ direction: "BUY", mid: 2600, spread: 0.4, slippage: 0.1 });
    const sell = modelFill({ direction: "SELL", mid: 2600, spread: 0.4, slippage: 0.1 });
    expect(buy.price).toBeCloseTo(2600.3, 3);
    expect(sell.price).toBeCloseTo(2599.7, 3);
    expect(buy.cost).toBeCloseTo(0.3, 3);
  });
});
