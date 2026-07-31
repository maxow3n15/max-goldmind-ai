// Cross-market correlation engine.
//
// Gold rarely moves alone. The dollar, the front and long end of the yield
// curve, silver and equity risk appetite all leave fingerprints. Confirming
// markets add confidence; conflicting ones subtract moderately — they never
// veto the trade on their own.

import type { CorrelationLeg, CorrelationReport } from "./quant.types";
import type { Direction } from "./types";

/** Sign of the historical relationship with gold, plus its influence weight. */
export const CORRELATION_MAP = [
  { symbol: "DX-Y.NYB", label: "US Dollar Index (DXY)", sign: -1, weight: 1.3 },
  { symbol: "^TNX", label: "US 10-Year Yield", sign: -1, weight: 1.1 },
  { symbol: "^FVX", label: "US 2-5Y Yield (front end)", sign: -1, weight: 0.9 },
  { symbol: "SI=F", label: "Silver (XAGUSD)", sign: 1, weight: 1.2 },
  { symbol: "^GSPC", label: "S&P 500", sign: -0.5, weight: 0.6 },
  { symbol: "^IXIC", label: "Nasdaq", sign: -0.5, weight: 0.5 },
] as const;

export interface CorrelationInput {
  /** symbol → % change over the correlation lookback window. */
  changes: Record<string, number | null>;
  direction?: Direction | null;
}

export function analyseCorrelation({ changes, direction }: CorrelationInput): CorrelationReport {
  const dirSign = direction === "SELL" ? -1 : 1;
  const legs: CorrelationLeg[] = [];
  let weighted = 0, totalWeight = 0, supporting = 0, conflicting = 0;

  for (const m of CORRELATION_MAP) {
    const change = changes[m.symbol];
    if (change == null || !Number.isFinite(change)) {
      legs.push({ symbol: m.symbol, label: m.label, change_pct: null, supports: null });
      continue;
    }
    // Implied gold direction from this market, then compare with the trade.
    const implied = Math.sign(change) * Math.sign(m.sign);
    const magnitude = Math.min(1, Math.abs(change) / 0.6); // 0.6% = full conviction
    const agreement = implied === 0 ? 0 : implied === dirSign ? magnitude : -magnitude;
    const supports = agreement === 0 ? null : agreement > 0;
    if (supports === true) supporting += 1;
    if (supports === false) conflicting += 1;
    weighted += agreement * m.weight;
    totalWeight += m.weight;
    legs.push({ symbol: m.symbol, label: m.label, change_pct: +change.toFixed(3), supports });
  }

  if (!totalWeight) {
    return {
      score: 50, notes: ["Correlated market data unavailable"], degraded: true,
      legs, supporting: 0, conflicting: 0,
    };
  }

  // Map -1..1 agreement onto 20..80 so correlation nudges rather than dominates.
  const score = Math.max(0, Math.min(100, Math.round(50 + (weighted / totalWeight) * 30)));
  const notes: string[] = [
    `${supporting} correlated market${supporting === 1 ? "" : "s"} confirming, ${conflicting} conflicting`,
  ];
  for (const l of legs) {
    if (l.change_pct == null) continue;
    notes.push(`${l.label}: ${l.change_pct > 0 ? "+" : ""}${l.change_pct}% — ${l.supports == null ? "flat" : l.supports ? "supports" : "conflicts with"} the ${direction ?? "current"} bias`);
  }

  return { score, notes, legs, supporting, conflicting };
}
