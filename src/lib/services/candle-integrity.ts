// Candle-series integrity.
//
// Every structural read (BOS, CHOCH, FVG, order blocks, liquidity) is only as
// trustworthy as the OHLC series underneath it. A duplicated bar shifts swing
// indexes, an out-of-order bar invents a fake break, and an impossible bar
// (high < low, close outside the range) poisons ATR and displacement maths.
//
// This module is the single gate every candle series passes through: it
// repairs what is safely repairable (ordering, exact duplicates), drops what
// is not (impossible OHLC, absurd prices), and reports everything it found so
// the pipeline can refuse to trade on a broken feed.

import type { Candle } from "@/lib/indicators";

export type SeriesStatus = "OK" | "DEGRADED" | "INVALID";

export interface IntegrityReport {
  status: SeriesStatus;
  /** Bars kept after cleaning. */
  count: number;
  duplicates: number;
  outOfOrder: number;
  impossible: number;
  /** Missing bars inferred from the modal spacing of the series. */
  gaps: number;
  /** Single-bar moves beyond ABNORMAL_MOVE_PCT of price. */
  abnormal: number;
  /** Age of the newest bar in ms, or null when the series is empty. */
  ageMs: number | null;
  issues: string[];
}

export interface IntegrityResult {
  candles: Candle[];
  report: IntegrityReport;
}

/** A single gold bar moving more than this is treated as a data artefact. */
export const ABNORMAL_MOVE_PCT = 5;
/** Fewer bars than this cannot support structural analysis. */
export const MIN_BARS = 20;

function isFiniteNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** True when the bar is internally coherent and priced plausibly. */
export function isValidCandle(c: Candle): boolean {
  if (!c || !isFiniteNum(c.t) || c.t <= 0) return false;
  if (![c.o, c.h, c.l, c.c].every(isFiniteNum)) return false;
  if (c.o <= 0 || c.h <= 0 || c.l <= 0 || c.c <= 0) return false;
  if (c.h < c.l) return false;
  if (c.o > c.h || c.o < c.l) return false;
  if (c.c > c.h || c.c < c.l) return false;
  return true;
}

/** Modal gap between consecutive bars — the series' true bar interval. */
function modalSpacing(candles: Candle[]): number | null {
  if (candles.length < 3) return null;
  const counts = new Map<number, number>();
  for (let i = 1; i < candles.length; i++) {
    const d = candles[i].t - candles[i - 1].t;
    if (d > 0) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [d, n] of counts) {
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  return best;
}

/**
 * Clean and grade a candle series.
 *
 * Repairs: sorts ascending by open time, collapses duplicate timestamps to the
 * last occurrence (providers re-send the forming bar).
 * Drops: impossible OHLC bars.
 * Reports: gaps, abnormal single-bar moves, staleness.
 */
export function validateSeries(raw: Candle[], now = Date.now()): IntegrityResult {
  const input = Array.isArray(raw) ? raw : [];
  const issues: string[] = [];

  let impossible = 0;
  const valid: Candle[] = [];
  for (const c of input) {
    if (isValidCandle(c)) valid.push(c);
    else impossible += 1;
  }
  if (impossible) issues.push(`${impossible} impossible OHLC bar(s) dropped`);

  let outOfOrder = 0;
  for (let i = 1; i < valid.length; i++) {
    if (valid[i].t < valid[i - 1].t) outOfOrder += 1;
  }
  if (outOfOrder) issues.push(`${outOfOrder} out-of-order bar(s) re-sorted`);

  const sorted = [...valid].sort((a, b) => a.t - b.t);

  // Collapse duplicate open times, keeping the last (most complete) version.
  const byTime = new Map<number, Candle>();
  let duplicates = 0;
  for (const c of sorted) {
    if (byTime.has(c.t)) duplicates += 1;
    byTime.set(c.t, c);
  }
  if (duplicates) issues.push(`${duplicates} duplicate timestamp(s) collapsed`);
  const candles = [...byTime.values()];

  // Gaps, measured against the series' own modal spacing.
  let gaps = 0;
  const spacing = modalSpacing(candles);
  if (spacing) {
    for (let i = 1; i < candles.length; i++) {
      const missing = Math.round((candles[i].t - candles[i - 1].t) / spacing) - 1;
      if (missing > 0) gaps += missing;
    }
  }
  // Weekend/session closures are normal for gold, so gaps only degrade the
  // series when they are frequent relative to its length.
  const gapRatio = candles.length ? gaps / candles.length : 0;
  if (gaps) issues.push(`${gaps} missing bar(s) inferred`);

  let abnormal = 0;
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].c;
    if (prev <= 0) continue;
    const move = (Math.abs(candles[i].c - prev) / prev) * 100;
    if (move > ABNORMAL_MOVE_PCT) abnormal += 1;
  }
  if (abnormal) issues.push(`${abnormal} abnormal single-bar move(s) > ${ABNORMAL_MOVE_PCT}%`);

  const ageMs = candles.length ? now - candles[candles.length - 1].t : null;

  let status: SeriesStatus = "OK";
  if (candles.length < MIN_BARS) {
    status = "INVALID";
    issues.push(`Only ${candles.length} usable bars (minimum ${MIN_BARS})`);
  } else if (impossible > 0 || abnormal > 0 || duplicates > 0 || outOfOrder > 0 || gapRatio > 0.25) {
    status = "DEGRADED";
  }

  return {
    candles,
    report: { status, count: candles.length, duplicates, outOfOrder, impossible, gaps, abnormal, ageMs, issues },
  };
}

/** Sanitised candles only — for call sites that do not need the report. */
export function sanitiseCandles(raw: Candle[]): Candle[] {
  return validateSeries(raw).candles;
}

/** Worst status across several series (used for the multi-timeframe verdict). */
export function worstStatus(statuses: SeriesStatus[]): SeriesStatus {
  if (statuses.includes("INVALID")) return "INVALID";
  if (statuses.includes("DEGRADED")) return "DEGRADED";
  return "OK";
}
