// Deterministic setup recognition (Phase 8).
//
// The model proposes a direction and price geometry; this module decides — from
// measured structure only — WHICH named GoldMind setup that proposal actually
// is, and whether every requirement of that setup is objectively present.
//
// Nothing here reads the model's prose or its confidence. It reads swings,
// sweeps, structural events, imbalances, order blocks, premium/discount and
// multi-timeframe bias. A proposal that matches no model is not tradable:
// GoldMind does not take setups it cannot name.

import type { MultiTimeframeReport } from "./mtf";
import { verdictDirection } from "./mtf";
import type { StructureRead } from "./structure";

export type SetupType =
  | "LIQUIDITY_SWEEP_REVERSAL"
  | "TREND_CONTINUATION"
  | "SESSION_REVERSAL"
  | "BREAKOUT_RETEST";

export type SetupVerdict = "VALID" | "INCOMPLETE" | "INVALID";

export interface SetupRequirement {
  key: string;
  label: string;
  met: boolean;
  detail: string;
  /** A failed hard requirement invalidates the model outright. */
  hard: boolean;
}

export interface SetupMatch {
  type: SetupType;
  verdict: SetupVerdict;
  /** 0..100 — share of requirements met, weighted towards hard ones. */
  completeness: number;
  requirements: SetupRequirement[];
}

export interface SetupClassification {
  /** Best match, or null when no model is even partially satisfied. */
  best: SetupMatch | null;
  /** Every model evaluated, best first. */
  matches: SetupMatch[];
  /** True only when a model is fully VALID. */
  tradable: boolean;
  /** Why the classification refuses the proposal, when it does. */
  reason: string | null;
}

export interface SetupProposal {
  direction: "BUY" | "SELL";
  entry: number;
  stop_loss: number;
  take_profit_1?: number | null;
}

export interface SetupContext {
  proposal: SetupProposal | null;
  /** Structure on the execution timeframe. */
  entryStructure: StructureRead | null;
  mtf: MultiTimeframeReport | null;
  /** Recent bars used for sweep recency, in ms. */
  now?: number;
  /** Session liquidity read, when available. */
  sessionSweep?: { side: "buy_side" | "sell_side"; reclaimed: boolean; t: number } | null;
  atr?: number | null;
}

/** Structural events younger than this still count as "recent". */
const RECENT_EVENT_MS = 6 * 60 * 60 * 1000;

function req(key: string, label: string, met: boolean, detail: string, hard = true): SetupRequirement {
  return { key, label, met, detail, hard };
}

function score(reqs: SetupRequirement[]): number {
  const total = reqs.reduce((a, r) => a + (r.hard ? 2 : 1), 0);
  if (total === 0) return 0;
  const got = reqs.reduce((a, r) => a + (r.met ? (r.hard ? 2 : 1) : 0), 0);
  return Math.round((got / total) * 100);
}

function verdictFor(reqs: SetupRequirement[]): SetupVerdict {
  if (reqs.some((r) => r.hard && !r.met)) return reqs.filter((r) => r.met).length === 0 ? "INVALID" : "INCOMPLETE";
  return reqs.every((r) => r.met) ? "VALID" : "INCOMPLETE";
}

function build(type: SetupType, reqs: SetupRequirement[]): SetupMatch {
  return { type, verdict: verdictFor(reqs), completeness: score(reqs), requirements: reqs };
}

function htfDirection(mtf: MultiTimeframeReport | null): "bullish" | "bearish" | "neutral" {
  if (!mtf) return "neutral";
  return verdictDirection(mtf.htf.verdict);
}

function wanted(direction: "BUY" | "SELL"): "bullish" | "bearish" {
  return direction === "BUY" ? "bullish" : "bearish";
}

function recentEvents(s: StructureRead, now: number) {
  return s.events.filter((e) => now - e.t <= RECENT_EVENT_MS);
}

/* ------------------------------------------------------------------ */
/* Model 1 — liquidity sweep reversal                                  */
/* ------------------------------------------------------------------ */

function liquiditySweepReversal(c: SetupContext, now: number): SetupMatch {
  const p = c.proposal!;
  const s = c.entryStructure;
  const dir = wanted(p.direction);
  const sweepSideNeeded = p.direction === "BUY" ? "sell_side" : "buy_side";

  const sweeps = (s?.sweeps ?? []).filter((x) => x.side === sweepSideNeeded && x.reclaimed);
  const sessionSweep =
    c.sessionSweep && c.sessionSweep.side === sweepSideNeeded && c.sessionSweep.reclaimed
      ? c.sessionSweep
      : null;
  const events = s ? recentEvents(s, now) : [];
  const flip = events.find((e) => e.type === "CHOCH" && e.direction === dir)
    ?? events.find((e) => e.type === "BOS" && e.direction === dir);

  const zone =
    (s?.fvgs ?? []).some((f) => f.direction === dir && !f.mitigated) ||
    (s?.orderBlocks ?? []).some((o) => o.direction === dir && !o.mitigated) ||
    (s?.breakers ?? []).some((b) => b.direction === dir);

  const location =
    s?.premiumDiscount == null
      ? false
      : p.direction === "BUY"
        ? s.premiumDiscount !== "premium"
        : s.premiumDiscount !== "discount";

  const htf = htfDirection(c.mtf);

  return build("LIQUIDITY_SWEEP_REVERSAL", [
    req(
      "sweep",
      "Liquidity taken and reclaimed",
      sweeps.length > 0 || !!sessionSweep,
      sweeps.length > 0
        ? `${sweeps.length} reclaimed ${sweepSideNeeded.replace("_", "-")} sweep(s)`
        : sessionSweep
          ? "session extreme swept and reclaimed"
          : "no reclaimed sweep on the required side",
    ),
    req(
      "flip",
      "Structure flipped after the sweep",
      !!flip,
      flip ? `${flip.type} ${flip.direction}` : "no CHOCH/BOS in the proposed direction",
    ),
    req(
      "zone",
      "Entry backed by an unmitigated imbalance or zone",
      zone,
      zone ? "FVG / order block / breaker present" : "no unmitigated FVG, OB or breaker",
    ),
    req(
      "location",
      "Price in the correct half of the dealing range",
      location,
      s?.premiumDiscount ? `price in ${s.premiumDiscount}` : "dealing range unknown",
    ),
    req(
      "htf",
      "Higher timeframe not opposed",
      htf === "neutral" || htf === dir,
      `HTF ${htf}`,
      false,
    ),
  ]);
}

/* ------------------------------------------------------------------ */
/* Model 2 — trend continuation                                        */
/* ------------------------------------------------------------------ */

function trendContinuation(c: SetupContext, now: number): SetupMatch {
  const p = c.proposal!;
  const s = c.entryStructure;
  const dir = wanted(p.direction);
  const htf = htfDirection(c.mtf);
  const events = s ? recentEvents(s, now) : [];
  const bos = events.find((e) => e.type === "BOS" && e.direction === dir);

  const pullbackZone =
    (s?.fvgs ?? []).some((f) => f.direction === dir && !f.mitigated) ||
    (s?.orderBlocks ?? []).some((o) => o.direction === dir && !o.mitigated);

  const discountEntry =
    s?.rangePosition == null
      ? false
      : p.direction === "BUY"
        ? s.rangePosition <= 0.62
        : s.rangePosition >= 0.38;

  return build("TREND_CONTINUATION", [
    req("htf", "Higher timeframe trends with the trade", htf === dir, `HTF ${htf}`),
    req("bias", "Execution timeframe agrees", s?.bias === dir, `execution bias ${s?.bias ?? "unknown"}`),
    req("bos", "Impulse confirmed by a break of structure", !!bos, bos ? `BOS ${bos.direction}` : "no recent BOS"),
    req(
      "pullback",
      "Retracement into an unmitigated zone",
      pullbackZone,
      pullbackZone ? "unmitigated FVG/OB in the path" : "no unmitigated continuation zone",
    ),
    req(
      "location",
      "Not chasing an extended move",
      discountEntry,
      s?.rangePosition != null ? `range position ${(s.rangePosition * 100).toFixed(0)}%` : "range unknown",
      false,
    ),
  ]);
}

/* ------------------------------------------------------------------ */
/* Model 3 — session reversal                                          */
/* ------------------------------------------------------------------ */

function sessionReversal(c: SetupContext, now: number): SetupMatch {
  const p = c.proposal!;
  const s = c.entryStructure;
  const dir = wanted(p.direction);
  const sideNeeded = p.direction === "BUY" ? "sell_side" : "buy_side";
  const sweep = c.sessionSweep && c.sessionSweep.side === sideNeeded ? c.sessionSweep : null;
  const events = s ? recentEvents(s, now) : [];
  const flip = events.find((e) => (e.type === "CHOCH" || e.type === "BOS") && e.direction === dir);

  return build("SESSION_REVERSAL", [
    req(
      "session_sweep",
      "Session extreme swept",
      !!sweep,
      sweep ? `session ${sideNeeded.replace("_", "-")} sweep` : "no session sweep on the required side",
    ),
    req("reclaim", "Sweep reclaimed", !!sweep?.reclaimed, sweep?.reclaimed ? "reclaimed" : "not reclaimed"),
    req("flip", "Lower-timeframe reversal confirmed", !!flip, flip ? `${flip.type} ${flip.direction}` : "no reversal event"),
    req(
      "target",
      "Opposing liquidity available as a target",
      p.take_profit_1 != null,
      p.take_profit_1 != null ? "target defined" : "no target",
      false,
    ),
  ]);
}

/* ------------------------------------------------------------------ */
/* Model 4 — breakout / retest                                         */
/* ------------------------------------------------------------------ */

function breakoutRetest(c: SetupContext, now: number): SetupMatch {
  const p = c.proposal!;
  const s = c.entryStructure;
  const dir = wanted(p.direction);
  const events = s ? recentEvents(s, now) : [];
  const bos = events.find((e) => e.type === "BOS" && e.direction === dir);
  const displacement = !!s?.displacement;

  // A retest means the proposed entry sits back at or inside the broken level.
  const level = bos?.price ?? null;
  const atr = c.atr ?? s?.atr ?? null;
  const tolerance = atr && atr > 0 ? atr * 1.5 : level ? level * 0.002 : 0;
  const retest = level != null && Math.abs(p.entry - level) <= tolerance;

  const zone =
    (s?.fvgs ?? []).some((f) => f.direction === dir) ||
    (s?.breakers ?? []).some((b) => b.direction === dir);

  return build("BREAKOUT_RETEST", [
    req("break", "Level broken with structure", !!bos, bos ? `BOS ${bos.direction}` : "no BOS"),
    req("displacement", "Break carried displacement", displacement, displacement ? "displacement present" : "no displacement candle"),
    req(
      "retest",
      "Entry is a retest of the broken level",
      retest,
      level != null ? `entry ${Math.abs(p.entry - level).toFixed(2)} from the level` : "no level to retest",
    ),
    req("zone", "Imbalance or breaker supports the retest", zone, zone ? "zone present" : "no supporting zone", false),
  ]);
}

/* ------------------------------------------------------------------ */
/* Classification                                                      */
/* ------------------------------------------------------------------ */

export function classifySetup(c: SetupContext): SetupClassification {
  if (!c.proposal) {
    return { best: null, matches: [], tradable: false, reason: "No setup proposed" };
  }
  if (!c.entryStructure) {
    return {
      best: null,
      matches: [],
      tradable: false,
      reason: "No measured market structure — setup cannot be classified",
    };
  }

  const now = c.now ?? Date.now();
  const matches = [
    liquiditySweepReversal(c, now),
    trendContinuation(c, now),
    sessionReversal(c, now),
    breakoutRetest(c, now),
  ].sort((a, b) => {
    const rank = (m: SetupMatch) => (m.verdict === "VALID" ? 2 : m.verdict === "INCOMPLETE" ? 1 : 0);
    return rank(b) - rank(a) || b.completeness - a.completeness;
  });

  const best = matches[0] ?? null;
  const tradable = best?.verdict === "VALID";
  const missing = best?.requirements.filter((r) => !r.met).map((r) => r.label) ?? [];

  return {
    best,
    matches,
    tradable,
    reason: tradable
      ? null
      : best
        ? `No complete setup model — closest is ${best.type} (${best.completeness}%), missing: ${missing.slice(0, 2).join(", ")}`
        : "No setup model matched",
  };
}
