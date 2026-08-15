// Monte Carlo and walk-forward analysis (Phases 24–25).
//
// Both operate on realised R multiples only — never on invented returns. If
// there are no trades there is no result: the functions return null rather
// than a fabricated distribution.

export interface MonteCarloInput {
  /** Realised R multiples, in chronological order. */
  rMultiples: number[];
  /** Risk fraction of equity per trade, e.g. 0.005 for 0.5%. */
  riskFraction: number;
  iterations?: number;
  /** Deterministic seed so a report is reproducible. */
  seed?: number;
  /** Equity at which the account is considered ruined, as a fraction. */
  ruinFraction?: number;
}

export interface MonteCarloReport {
  iterations: number;
  trades: number;
  /** Percentiles of final equity multiple (1 = break even). */
  finalEquity: { p5: number; p25: number; median: number; p75: number; p95: number };
  /** Percentiles of maximum peak-to-trough drawdown, in percent. */
  drawdown: { median: number; p75: number; p95: number; worst: number };
  /** Longest run of consecutive losses observed. */
  losingStreak: { median: number; p95: number; worst: number };
  /** Share of paths that fell below the ruin threshold. */
  riskOfRuinPct: number;
  /** Median number of trades to recover the worst drawdown, null when never. */
  medianRecoveryTrades: number | null;
}

/** Mulberry32 — small, fast, fully deterministic. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx]!;
}

export function runMonteCarlo(input: MonteCarloInput): MonteCarloReport | null {
  const rs = input.rMultiples.filter((r) => Number.isFinite(r));
  if (rs.length < 5) return null;

  const iterations = Math.min(5000, Math.max(200, input.iterations ?? 2000));
  const risk = input.riskFraction > 0 ? input.riskFraction : 0.005;
  const ruinAt = input.ruinFraction ?? 0.5;
  const rand = rng(input.seed ?? 20260815);

  const finals: number[] = [];
  const dds: number[] = [];
  const streaks: number[] = [];
  const recoveries: number[] = [];
  let ruined = 0;

  for (let it = 0; it < iterations; it++) {
    let equity = 1;
    let peak = 1;
    let maxDd = 0;
    let streak = 0;
    let worstStreak = 0;
    let ddStartIdx: number | null = null;
    let recoveryTrades: number | null = null;
    let hitRuin = false;

    for (let n = 0; n < rs.length; n++) {
      const r = rs[Math.floor(rand() * rs.length)]!;
      // Compounded fixed-fractional risk: one R equals `risk` of current equity.
      equity *= 1 + r * risk;
      if (equity <= 0) equity = 0;

      if (r < 0) {
        streak += 1;
        worstStreak = Math.max(worstStreak, streak);
      } else {
        streak = 0;
      }

      if (equity > peak) {
        peak = equity;
        if (ddStartIdx != null && recoveryTrades == null) recoveryTrades = n - ddStartIdx;
        ddStartIdx = null;
      } else {
        const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
        if (dd > maxDd) {
          maxDd = dd;
          ddStartIdx = n;
        }
      }

      if (equity <= ruinAt) {
        hitRuin = true;
        break;
      }
    }

    if (hitRuin) ruined += 1;
    finals.push(equity);
    dds.push(maxDd);
    streaks.push(worstStreak);
    if (recoveryTrades != null) recoveries.push(recoveryTrades);
  }

  finals.sort((a, b) => a - b);
  dds.sort((a, b) => a - b);
  streaks.sort((a, b) => a - b);
  recoveries.sort((a, b) => a - b);

  const round = (n: number, d = 4) => Number(n.toFixed(d));

  return {
    iterations,
    trades: rs.length,
    finalEquity: {
      p5: round(percentile(finals, 5)),
      p25: round(percentile(finals, 25)),
      median: round(percentile(finals, 50)),
      p75: round(percentile(finals, 75)),
      p95: round(percentile(finals, 95)),
    },
    drawdown: {
      median: round(percentile(dds, 50), 2),
      p75: round(percentile(dds, 75), 2),
      p95: round(percentile(dds, 95), 2),
      worst: round(dds[dds.length - 1] ?? 0, 2),
    },
    losingStreak: {
      median: percentile(streaks, 50),
      p95: percentile(streaks, 95),
      worst: streaks[streaks.length - 1] ?? 0,
    },
    riskOfRuinPct: round((ruined / iterations) * 100, 2),
    medianRecoveryTrades: recoveries.length ? percentile(recoveries, 50) : null,
  };
}

/* ------------------------------------------------------------------ */
/* Walk-forward                                                        */
/* ------------------------------------------------------------------ */

export interface WalkForwardWindow<T> {
  index: number;
  train: T[];
  test: T[];
}

export interface WalkForwardFold {
  index: number;
  trainTrades: number;
  testTrades: number;
  trainExpectancy: number;
  testExpectancy: number;
  /** Test expectancy divided by train expectancy; <1 means degradation. */
  efficiency: number | null;
}

export interface WalkForwardReport {
  folds: WalkForwardFold[];
  /** Median out-of-sample efficiency across folds. */
  medianEfficiency: number | null;
  /** Share of folds whose out-of-sample expectancy stayed positive. */
  positiveFoldsPct: number;
  degraded: boolean;
}

/**
 * Rolling train/test split. The caller supplies chronologically ordered items;
 * no item ever appears in both the train and test side of the same fold.
 */
export function buildWalkForwardWindows<T>(
  items: T[],
  opts: { trainSize: number; testSize: number; step?: number },
): WalkForwardWindow<T>[] {
  const { trainSize, testSize } = opts;
  const step = opts.step ?? testSize;
  const out: WalkForwardWindow<T>[] = [];
  if (trainSize <= 0 || testSize <= 0) return out;
  let start = 0;
  let index = 0;
  while (start + trainSize + testSize <= items.length) {
    out.push({
      index: index++,
      train: items.slice(start, start + trainSize),
      test: items.slice(start + trainSize, start + trainSize + testSize),
    });
    start += step;
  }
  return out;
}

function expectancy(rs: number[]): number {
  if (rs.length === 0) return 0;
  return Number((rs.reduce((a, b) => a + b, 0) / rs.length).toFixed(4));
}

export function runWalkForward(
  rMultiples: number[],
  opts: { trainSize: number; testSize: number; step?: number },
): WalkForwardReport | null {
  const rs = rMultiples.filter((r) => Number.isFinite(r));
  const windows = buildWalkForwardWindows(rs, opts);
  if (windows.length === 0) return null;

  const folds: WalkForwardFold[] = windows.map((w) => {
    const trainExpectancy = expectancy(w.train);
    const testExpectancy = expectancy(w.test);
    return {
      index: w.index,
      trainTrades: w.train.length,
      testTrades: w.test.length,
      trainExpectancy,
      testExpectancy,
      efficiency: trainExpectancy > 0 ? Number((testExpectancy / trainExpectancy).toFixed(3)) : null,
    };
  });

  const effs = folds.map((f) => f.efficiency).filter((e): e is number => e != null).sort((a, b) => a - b);
  const medianEfficiency = effs.length ? percentile(effs, 50) : null;
  const positive = folds.filter((f) => f.testExpectancy > 0).length;

  return {
    folds,
    medianEfficiency,
    positiveFoldsPct: Number(((positive / folds.length) * 100).toFixed(1)),
    degraded: medianEfficiency != null ? medianEfficiency < 0.5 : true,
  };
}
