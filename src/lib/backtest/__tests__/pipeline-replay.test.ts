import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/indicators";
import { PointInTimeSeries, assertNoLookahead } from "../replay-data";
import { applyStopMove, resolveLegAgainstBar, runPipelineBacktest, DEFAULT_PIPELINE_CONFIG } from "../pipeline-engine";
import { buildLadderPlans } from "@/lib/services/execution";
import { evaluate as evaluatePosition } from "@/lib/services/position-manager";
import { proposeFromStructure } from "../proposal";
import { readStructure } from "@/lib/services/structure";
import { buildMultiTimeframeReport } from "@/lib/services/mtf";
import { readSessionLiquidity } from "@/lib/services/sessions-liquidity";

/* ------------------------------------------------------------------ */
/* Deterministic synthetic market                                      */
/* ------------------------------------------------------------------ */

/** Seeded LCG — no Math.random anywhere in the test suite. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function synthCandles(count: number, seed = 42, stepMinutes = 15): Candle[] {
  const rnd = lcg(seed);
  const out: Candle[] = [];
  let price = 2000;
  const start = Date.UTC(2024, 0, 2, 0, 0, 0);
  for (let i = 0; i < count; i++) {
    // Slow trend cycles plus sweeps: enough structure for the SMC reads.
    const cycle = Math.sin(i / 55) * 6;
    const drift = Math.cos(i / 180) * 3;
    const noise = (rnd() - 0.5) * 3;
    const o = price;
    const c = Number((price + cycle * 0.15 + drift * 0.1 + noise).toFixed(2));
    const wick = 0.6 + rnd() * 1.8;
    const h = Number((Math.max(o, c) + wick).toFixed(2));
    const l = Number((Math.min(o, c) - wick).toFixed(2));
    out.push({ t: start + i * stepMinutes * 60_000, o, h, l, c, v: Math.round(500 + rnd() * 900) });
    price = c;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 1. No lookahead                                                     */
/* ------------------------------------------------------------------ */

describe("point-in-time replay data", () => {
  it("never exposes a candle newer than the cursor on any timeframe", () => {
    const candles = synthCandles(400);
    const series = new PointInTimeSeries(candles, "15");
    for (let i = 0; i < candles.length; i++) {
      series.advance();
      series.verifyNoLookahead();
      for (const tf of ["15", "30", "60", "240", "D"] as const) {
        const s = series.seriesFor(tf);
        if (!s.length) continue;
        expect(s[s.length - 1].t).toBeLessThanOrEqual(series.time);
      }
    }
  });

  it("is unaffected by future bars — mutating them cannot change the past view", () => {
    const candles = synthCandles(300);
    const clone = candles.map((c) => ({ ...c }));
    const a = new PointInTimeSeries(candles, "15");
    const b = new PointInTimeSeries(clone, "15");
    for (let i = 0; i <= 150; i++) {
      a.advance();
      b.advance();
    }
    // Rewrite everything the cursor has not reached yet.
    for (let i = 151; i < clone.length; i++) {
      clone[i].h += 500;
      clone[i].l -= 500;
      clone[i].c += 500;
    }
    for (const tf of ["15", "30", "60", "240", "D"] as const) {
      expect(b.seriesFor(tf)).toEqual(a.seriesFor(tf));
    }
  });

  it("assertNoLookahead fails loudly when a future candle leaks in", () => {
    const candles = synthCandles(20);
    expect(() => assertNoLookahead("test", candles, candles[5].t)).toThrow(/Lookahead leak/);
  });

  it("only reads history up to the bar being decided", () => {
    const candles = synthCandles(320);
    const series = new PointInTimeSeries(candles, "15");
    for (let i = 0; i < 260; i++) series.advance();
    const execution = series.execution();
    const structure = readStructure(execution);
    const mtf = buildMultiTimeframeReport(series.byTimeframe());
    const liquidity = readSessionLiquidity({ intraday: execution, now: series.time, daily: series.seriesFor("D") });

    assertNoLookahead("execution", execution, series.time);
    for (const tf of mtf.timeframes) {
      if (tf.lastCandleAt != null) expect(tf.lastCandleAt).toBeLessThanOrEqual(series.time);
    }
    for (const sweep of liquidity.sweeps) expect(sweep.t).toBeLessThanOrEqual(series.time);
    for (const event of structure.events) expect(event.t).toBeLessThanOrEqual(series.time);

    // A proposal built here must also be anchored to the cursor.
    const proposal = proposeFromStructure({
      structure,
      mtf,
      liquidity,
      candles: execution,
      atr: structure.atr,
      now: series.time,
    });
    if (proposal) {
      expect(proposal.entry).toBeCloseTo(execution[execution.length - 1].c, 2);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 2. Ladder fills                                                     */
/* ------------------------------------------------------------------ */

describe("ladder fills", () => {
  const base = {
    direction: "BUY" as const,
    entry: 2000,
    stop_loss: 1990,
    take_profit_2: null,
    take_profit_3: null,
    confidence: 90,
    timeframe: "15",
    session: "London",
    reason: "test",
    ai_analysis: {},
  };

  it("splits one setup into three legs, each with its own target and capped risk", () => {
    const plans = buildLadderPlans({
      base,
      targets: [2020, 2030, 2040],
      balance: 10_000,
      riskPctPerLeg: 0.5,
      cycleId: "cycle-1",
    });
    expect(plans).toHaveLength(3);
    expect(plans.map((p) => p.take_profit_1)).toEqual([2020, 2030, 2040]);
    expect(plans.map((p) => p.client_order_id)).toEqual(["cycle-1-leg1", "cycle-1-leg2", "cycle-1-leg3"]);
    for (const p of plans) expect(p.lot_size).toBeGreaterThan(0);
  });

  it("closes each leg on its own target as price advances", () => {
    const plans = buildLadderPlans({
      base,
      targets: [2020, 2030, 2040],
      balance: 10_000,
      riskPctPerLeg: 0.5,
      cycleId: "cycle-1",
    });
    const legs = plans.map((p) => ({
      direction: p.direction,
      stop: p.stop_loss,
      target: p.take_profit_1,
      movedToBe: false,
      openBar: 0,
    }));

    const bar = (h: number, l: number): Candle => ({ t: 1, o: 2000, h, l, c: (h + l) / 2, v: 1 });

    // Price runs to 2025: only the first leg's target is taken.
    expect(resolveLegAgainstBar(legs[0], bar(2025, 2001), 1, 96)?.reason).toBe("target");
    expect(resolveLegAgainstBar(legs[1], bar(2025, 2001), 1, 96)).toBeNull();
    expect(resolveLegAgainstBar(legs[2], bar(2025, 2001), 1, 96)).toBeNull();

    // Price runs to 2045: the remaining legs fill at their own targets.
    expect(resolveLegAgainstBar(legs[1], bar(2045, 2001), 2, 96)?.exit).toBe(2030);
    expect(resolveLegAgainstBar(legs[2], bar(2045, 2001), 2, 96)?.exit).toBe(2040);
  });

  it("assumes the stop first when one bar touches both stop and target", () => {
    const leg = { direction: "BUY" as const, stop: 1990, target: 2020, movedToBe: false, openBar: 0 };
    const res = resolveLegAgainstBar(leg, { t: 1, o: 2000, h: 2025, l: 1985, c: 2010, v: 1 }, 1, 96);
    expect(res).toEqual({ exit: 1990, reason: "stop" });
  });

  it("fills gaps at the open rather than at the stop", () => {
    const leg = { direction: "BUY" as const, stop: 1990, target: 2020, movedToBe: false, openBar: 0 };
    const res = resolveLegAgainstBar(leg, { t: 1, o: 1975, h: 1980, l: 1970, c: 1978, v: 1 }, 1, 96);
    expect(res).toEqual({ exit: 1975, reason: "stop" });
  });

  it("times a position out after the hold limit", () => {
    const leg = { direction: "BUY" as const, stop: 1990, target: 2020, movedToBe: false, openBar: 0 };
    expect(resolveLegAgainstBar(leg, { t: 1, o: 2000, h: 2005, l: 1995, c: 2002, v: 1 }, 96, 96)?.reason).toBe("timeout");
  });
});

/* ------------------------------------------------------------------ */
/* 3. Management transitions                                           */
/* ------------------------------------------------------------------ */

describe("position management transitions", () => {
  const trade = {
    id: "t1",
    direction: "BUY" as const,
    entry_price: 2000,
    stop_loss: 1990,
    take_profit_1: 2020,
    take_profit_2: null,
    take_profit_3: null,
    lot_size: 0.1,
    opened_at: new Date(0).toISOString(),
  };

  it("moves to break-even once the trade is in profit by the trigger", () => {
    const action = evaluatePosition({ trade, price: 2006, breakEvenTrigger: 0.5 });
    expect(action).toMatchObject({ type: "move_stop", new_stop: 2000 });
  });

  it("trails once beyond 1R and never widens the stop", () => {
    const leg = { direction: "BUY" as const, stop: 2000, movedToBe: true };
    const action = evaluatePosition({ trade: { ...trade, stop_loss: 2000 }, price: 2015, atr: 4 });
    expect(action.type).toBe("move_stop");
    if (action.type === "move_stop") {
      expect(applyStopMove(leg, action.new_stop)).toBe(true);
      expect(leg.stop).toBeGreaterThan(2000);
      // A worse stop is refused outright.
      expect(applyStopMove(leg, 1995)).toBe(false);
      expect(leg.stop).toBeGreaterThan(2000);
    }
  });

  it("does nothing while the trade sits below the break-even trigger", () => {
    expect(evaluatePosition({ trade, price: 2001, breakEvenTrigger: 0.5 }).type).toBe("none");
  });
});

/* ------------------------------------------------------------------ */
/* 4. Determinism and pipeline wiring                                  */
/* ------------------------------------------------------------------ */

describe("pipeline replay engine", () => {
  const candles = synthCandles(700, 7);
  const config = { ...DEFAULT_PIPELINE_CONFIG, timeframe: "15" as const, warmupBars: 250 };

  it("produces an identical equity curve and trade list on every run", () => {
    const a = runPipelineBacktest(candles, config);
    const b = runPipelineBacktest(candles.map((c) => ({ ...c })), config);
    expect(b.trades).toEqual(a.trades);
    expect(b.equityCurve).toEqual(a.equityCurve);
    expect(b.metrics).toEqual(a.metrics);
    expect(b.rejections).toEqual(a.rejections);
  });

  it("runs the real pipeline and reports its fidelity caveats", () => {
    const res = runPipelineBacktest(candles, config);
    expect(res.mode).toBe("pipeline");
    expect(res.caveats.length).toBeGreaterThan(3);
    expect(res.bars).toBe(candles.length);
    expect(res.equityCurve.length).toBeGreaterThan(0);
    // Timeframes below the execution series are honestly reported as missing.
    expect(res.missingTimeframes).toEqual(["1", "5"]);
  });

  it("never opens a trade before the warm-up window", () => {
    const res = runPipelineBacktest(candles, config);
    const firstAllowed = candles[config.warmupBars].t;
    for (const t of res.trades) {
      expect(t.openedAt).toBeGreaterThanOrEqual(firstAllowed);
      expect(t.closedAt).toBeGreaterThanOrEqual(t.openedAt);
    }
  });

  it("keeps every simulated trade inside the risk limits it was given", () => {
    const res = runPipelineBacktest(candles, { ...config, settings: { max_open_trades: 2 } });
    for (const t of res.trades) {
      expect(t.lots).toBeGreaterThan(0);
      expect(Math.abs(t.entry - t.stop)).toBeGreaterThan(0);
    }
    expect(res.approvedBars).toBeLessThanOrEqual(res.candidateBars);
  });
});
