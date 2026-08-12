// Deterministic structured confidence engine.
//
// The AI is allowed to describe the market; it is NOT allowed to pick the
// number. Every point in the final score traces back to a named factor with a
// configurable weight, an observed input and a pass/partial/fail verdict.
//
// Pure: same inputs → same score, always.

import type { MacroReport } from "./macro.types";
import type { CorrelationReport, MomentumReport, SessionReport, VolatilityReport, VolumeReport } from "./quant.types";
import type { MultiTimeframeReport } from "./mtf";
import { verdictDirection } from "./mtf";
import type { StructureRead } from "./structure";
import type { DataQuality } from "./data-quality";

export type FactorKey =
  | "htf_alignment"
  | "structure"
  | "liquidity"
  | "entry_zone"
  | "fvg_ob"
  | "momentum"
  | "smt"
  | "news_macro"
  | "risk_reward"
  | "market_conditions";

/** Default weights, summing to 100. Overridable per user via settings. */
export const DEFAULT_CONFIDENCE_WEIGHTS: Record<FactorKey, number> = {
  htf_alignment: 15,
  structure: 15,
  liquidity: 10,
  entry_zone: 10,
  fvg_ob: 10,
  momentum: 10,
  smt: 5,
  news_macro: 10,
  risk_reward: 10,
  market_conditions: 5,
};

export const FACTOR_LABELS: Record<FactorKey, string> = {
  htf_alignment: "Higher-timeframe alignment",
  structure: "Market structure",
  liquidity: "Liquidity",
  entry_zone: "Entry zone quality",
  fvg_ob: "FVG / order block",
  momentum: "Momentum",
  smt: "SMT divergence",
  news_macro: "News & macro",
  risk_reward: "Risk / reward",
  market_conditions: "Market conditions",
};

export interface ConfidenceFactor {
  key: FactorKey;
  label: string;
  weight: number;
  /** 0..1 — how much of the weight this factor earned. */
  ratio: number;
  points: number;
  verdict: "pass" | "partial" | "fail" | "unavailable";
  detail: string;
}

export interface StructuredConfidence {
  /** 0..100, deterministic. */
  score: number;
  factors: ConfidenceFactor[];
  supporting: string[];
  detracting: string[];
  /** Weight excluded because its input was unavailable. */
  unavailableWeight: number;
  weights: Record<FactorKey, number>;
}

export interface ConfidenceInput {
  setup: { direction: "BUY" | "SELL"; entry: number; stop_loss: number; take_profit_1: number; risk_reward?: number } | null;
  mtf: MultiTimeframeReport | null;
  /** Structure read on the trading timeframe. */
  entryStructure: StructureRead | null;
  macro: MacroReport | null;
  momentum?: MomentumReport | null;
  volatility?: VolatilityReport | null;
  volume?: VolumeReport | null;
  correlation?: CorrelationReport | null;
  session?: SessionReport | null;
  dataQuality: DataQuality | null;
  spread: number | null;
  maxSpread: number;
  minRr: number;
  weights?: Partial<Record<FactorKey, number>>;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function resolveWeights(overrides?: Partial<Record<FactorKey, number>>): Record<FactorKey, number> {
  const merged = { ...DEFAULT_CONFIDENCE_WEIGHTS, ...(overrides ?? {}) } as Record<FactorKey, number>;
  for (const k of Object.keys(merged) as FactorKey[]) {
    const v = Number(merged[k]);
    merged[k] = Number.isFinite(v) && v >= 0 ? v : 0;
  }
  return merged;
}

export function computeStructuredConfidence(i: ConfidenceInput): StructuredConfidence {
  const weights = resolveWeights(i.weights);
  const factors: ConfidenceFactor[] = [];

  const dir = i.setup ? (i.setup.direction === "BUY" ? "bullish" : "bearish") : null;

  const add = (
    key: FactorKey,
    ratio: number | null,
    detail: string,
  ) => {
    const weight = weights[key] ?? 0;
    if (ratio == null) {
      factors.push({ key, label: FACTOR_LABELS[key], weight, ratio: 0, points: 0, verdict: "unavailable", detail });
      return;
    }
    const r = clamp01(ratio);
    factors.push({
      key,
      label: FACTOR_LABELS[key],
      weight,
      ratio: Number(r.toFixed(3)),
      points: Number((weight * r).toFixed(2)),
      verdict: r >= 0.75 ? "pass" : r >= 0.4 ? "partial" : "fail",
      detail,
    });
  };

  /* --- HTF alignment ------------------------------------------------- */
  if (!i.mtf || i.mtf.degraded) {
    add("htf_alignment", null, "Multi-timeframe data unavailable");
  } else {
    const htfDir = verdictDirection(i.mtf.htf.verdict);
    const mtfDir = verdictDirection(i.mtf.mtf.verdict);
    if (!dir) {
      add("htf_alignment", 0.5, `HTF ${i.mtf.htf.verdict}, no setup direction`);
    } else {
      let r = 0;
      if (htfDir === dir) r += 0.6;
      else if (htfDir === "neutral") r += 0.25;
      if (mtfDir === dir) r += 0.25;
      else if (mtfDir === "neutral") r += 0.1;
      r += (i.mtf.alignment / 100) * 0.15;
      add("htf_alignment", r, `HTF ${i.mtf.htf.verdict} · MTF ${i.mtf.mtf.verdict} · ${i.mtf.alignment}% agreement`);
    }
  }

  /* --- Structure ------------------------------------------------------ */
  const st = i.entryStructure;
  if (!st || st.lastPrice == null) {
    add("structure", null, "No structural read on the trading timeframe");
  } else {
    const latest = st.events[0] ?? null;
    let r = 0;
    if (latest && dir && latest.direction === dir) r += latest.type === "BOS" ? 0.6 : 0.5;
    else if (latest && dir) r += 0.05;
    if (st.bias === dir) r += 0.25;
    if (st.displacement && latest && dir && latest.direction === dir) r += 0.15;
    add(
      "structure",
      r,
      latest ? `${latest.type} ${latest.direction}${st.displacement ? " + displacement" : ""}` : "No recent BOS/CHOCH",
    );
  }

  /* --- Liquidity ------------------------------------------------------ */
  if (!st) {
    add("liquidity", null, "No liquidity read");
  } else {
    const pools = dir === "bullish" ? st.equalLows : dir === "bearish" ? st.equalHighs : [];
    const opposing = dir === "bullish" ? st.equalHighs : st.equalLows;
    let r = 0;
    if (pools.length > 0) r += 0.55; // liquidity taken on the entry side
    if (opposing.length > 0) r += 0.3; // a draw on liquidity to target
    if (st.premiumDiscount) r += 0.15;
    add(
      "liquidity",
      r,
      `${pools.length} pool(s) behind entry, ${opposing.length} target pool(s)`,
    );
  }

  /* --- Entry zone ------------------------------------------------------ */
  if (!st || !i.setup || st.rangePosition == null) {
    add("entry_zone", null, "Dealing range unavailable");
  } else {
    const pos = st.rangePosition;
    // Longs want discount (<0.5), shorts want premium (>0.5).
    const quality = dir === "bullish" ? 1 - pos : pos;
    add("entry_zone", quality, `Range position ${(pos * 100).toFixed(0)}% (${st.premiumDiscount ?? "n/a"})`);
  }

  /* --- FVG / order block ------------------------------------------------ */
  if (!st || !i.setup) {
    add("fvg_ob", null, "No PD-array data");
  } else {
    const entry = i.setup.entry;
    const wantDir = dir === "bullish" ? "bullish" : "bearish";
    const fvg = st.fvgs.find(
      (g) => g.direction === wantDir && entry <= g.top * 1.001 && entry >= g.bottom * 0.999,
    );
    const ob = st.orderBlocks.find(
      (b) => b.direction === wantDir && entry <= b.top * 1.001 && entry >= b.bottom * 0.999,
    );
    let r = 0;
    if (fvg) r += 0.55;
    if (ob) r += 0.45;
    if (!fvg && !ob) {
      const nearby = st.fvgs.filter((g) => g.direction === wantDir && !g.mitigated).length;
      r = nearby ? 0.25 : 0;
    }
    add("fvg_ob", r, fvg || ob ? `Entry inside ${[fvg && "FVG", ob && "order block"].filter(Boolean).join(" + ")}` : "Entry not inside a PD array");
  }

  /* --- Momentum --------------------------------------------------------- */
  if (i.momentum == null) add("momentum", null, "Momentum module unavailable");
  else add("momentum", i.momentum.score / 100, `Momentum score ${Math.round(i.momentum.score)}/100`);

  /* --- SMT -------------------------------------------------------------- */
  if (!i.correlation || i.correlation.legs?.length === 0) {
    add("smt", null, "SMT UNAVAILABLE — no correlated real-time data");
  } else {
    add("smt", i.correlation.score / 100, `Correlation score ${Math.round(i.correlation.score)}/100`);
  }

  /* --- News / macro ------------------------------------------------------ */
  if (!i.macro || i.macro.degraded) {
    add("news_macro", null, "Macro feed degraded");
  } else {
    const directional = dir === "bearish" ? 100 - i.macro.news_score : i.macro.news_score;
    let r = directional / 100;
    if (i.macro.blackout.active) r = 0;
    add(
      "news_macro",
      r,
      i.macro.blackout.active
        ? `Blackout: ${i.macro.blackout.reason ?? "high-impact event"}`
        : `Directional macro ${Math.round(directional)}/100`,
    );
  }

  /* --- Risk / reward ------------------------------------------------------ */
  if (!i.setup) {
    add("risk_reward", null, "No setup");
  } else {
    const risk = Math.abs(i.setup.entry - i.setup.stop_loss);
    const reward = Math.abs(i.setup.take_profit_1 - i.setup.entry);
    const rr = risk > 0 ? reward / risk : 0;
    // Full credit at 2x the configured minimum, zero below the minimum.
    const r = rr < i.minRr ? 0 : clamp01((rr - i.minRr) / Math.max(0.5, i.minRr) + 0.5);
    add("risk_reward", r, `R:R ${rr.toFixed(2)} (min ${i.minRr})`);
  }

  /* --- Market conditions --------------------------------------------------- */
  {
    const parts: number[] = [];
    const notes: string[] = [];
    if (i.dataQuality) {
      parts.push(i.dataQuality.status === "LIVE" ? 1 : i.dataQuality.status === "DELAYED" ? 0.5 : 0);
      notes.push(`data ${i.dataQuality.status}`);
    }
    if (i.spread != null && i.maxSpread > 0) {
      parts.push(clamp01(1 - i.spread / i.maxSpread));
      notes.push(`spread ${i.spread.toFixed(2)}`);
    }
    if (i.volatility) {
      parts.push(i.volatility.score / 100);
      notes.push(`volatility ${Math.round(i.volatility.score)}`);
    }
    if (i.volume) {
      parts.push(i.volume.score / 100);
      notes.push(`volume ${Math.round(i.volume.score)}`);
    }
    if (i.session) {
      parts.push(i.session.score / 100);
      notes.push(`session ${Math.round(i.session.score)}`);
    }
    add(
      "market_conditions",
      parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null,
      notes.join(" · ") || "No condition inputs",
    );
  }

  /* --- Aggregate ----------------------------------------------------------- */
  const usable = factors.filter((f) => f.verdict !== "unavailable");
  const usableWeight = usable.reduce((a, f) => a + f.weight, 0);
  const unavailableWeight = factors.filter((f) => f.verdict === "unavailable").reduce((a, f) => a + f.weight, 0);
  const earned = usable.reduce((a, f) => a + f.points, 0);

  // Missing inputs cannot inflate the score: the earned share is scaled by
  // how much of the model we could actually evaluate, with a mild penalty.
  const coverage = usableWeight / (usableWeight + unavailableWeight || 1);
  const raw = usableWeight > 0 ? (earned / usableWeight) * 100 : 0;
  const score = Math.round(raw * (0.85 + 0.15 * coverage));

  return {
    score: Math.max(0, Math.min(100, score)),
    factors,
    supporting: factors.filter((f) => f.verdict === "pass").map((f) => `${f.label} — ${f.detail}`),
    detracting: factors
      .filter((f) => f.verdict === "fail" || f.verdict === "unavailable")
      .map((f) => `${f.label} — ${f.detail}`),
    unavailableWeight,
    weights,
  };
}
