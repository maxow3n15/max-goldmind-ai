// Structure-derived proposal generator for pipeline replay.
//
// In live trading the direction/entry/stop/target proposal comes from the AI,
// and `setup-models.ts` then decides whether that proposal is a nameable
// GoldMind setup. A backtest cannot call the model for every historical bar,
// so this module inverts the classifier: it constructs candidate proposals
// directly from measured structure and keeps only those the real classifier
// certifies as VALID.
//
// It deliberately produces *candidates*, not decisions. Everything downstream
// — confidence engine, composite, safety, risk sizing, position management —
// is the real production pipeline, unchanged.

import type { Candle } from "@/lib/indicators";
import type { MultiTimeframeReport } from "@/lib/services/mtf";
import { verdictDirection } from "@/lib/services/mtf";
import type { StructureRead } from "@/lib/services/structure";
import type { SessionLiquidityRead } from "@/lib/services/sessions-liquidity";
import { classifySetup, type SetupClassification, type SetupType } from "@/lib/services/setup-models";
import type { Direction } from "@/lib/services/types";

export interface ReplayProposal {
  direction: Direction;
  entry: number;
  stop_loss: number;
  take_profit_1: number;
  take_profit_2: number;
  take_profit_3: number;
  risk_reward: number;
  /** Which model the candidate was constructed for. */
  model: SetupType;
  /** The classifier's verdict on the candidate. */
  classification: SetupClassification;
  origin: string;
}

/** Target ladder, expressed in multiples of the measured risk distance. */
export const TARGET_R_MULTIPLES = [2, 3, 4] as const;

export interface ProposalInput {
  structure: StructureRead;
  mtf: MultiTimeframeReport | null;
  liquidity: SessionLiquidityRead | null;
  candles: Candle[];
  atr: number | null;
  now: number;
  /** Minimum stop distance as a fraction of price. */
  minStopPct?: number;
  /** Maximum stop distance as a fraction of price. */
  maxStopPct?: number;
}

interface Candidate {
  direction: Direction;
  stop: number;
  model: SetupType;
  origin: string;
}

function sessionSweepFor(liquidity: SessionLiquidityRead | null) {
  const sweep = liquidity?.sweeps?.[0] ?? null;
  if (!sweep) return null;
  return { side: sweep.side, reclaimed: sweep.reclaimed, t: sweep.t, level: sweep.level, penetration: sweep.penetration };
}

function buildCandidates(i: ProposalInput, direction: Direction): Candidate[] {
  const s = i.structure;
  const atr = i.atr && i.atr > 0 ? i.atr : (s.atr && s.atr > 0 ? s.atr : null);
  const buffer = atr ? atr * 0.25 : (s.lastPrice ?? 0) * 0.0005;
  const isBuy = direction === "BUY";
  const wanted = isBuy ? "bullish" : "bearish";
  const sweepSide = isBuy ? "sell_side" : "buy_side";
  const out: Candidate[] = [];

  // 1. Liquidity sweep reversal — protect beyond the swept extreme.
  const swing = s.sweeps.find((x) => x.side === sweepSide && x.reclaimed);
  if (swing) {
    const extreme = isBuy ? swing.level - swing.penetration : swing.level + swing.penetration;
    out.push({
      direction,
      stop: isBuy ? extreme - buffer : extreme + buffer,
      model: "LIQUIDITY_SWEEP_REVERSAL",
      origin: `reclaimed ${sweepSide.replace("_", "-")} sweep at ${swing.level.toFixed(2)}`,
    });
  }

  // 2. Session reversal — protect beyond the swept session extreme.
  const session = sessionSweepFor(i.liquidity);
  if (session && session.side === sweepSide) {
    const extreme = isBuy ? session.level - session.penetration : session.level + session.penetration;
    out.push({
      direction,
      stop: isBuy ? extreme - buffer : extreme + buffer,
      model: "SESSION_REVERSAL",
      origin: `session ${sweepSide.replace("_", "-")} sweep at ${session.level.toFixed(2)}`,
    });
  }

  // 3. Trend continuation — protect beyond the last protected pivot.
  const pivot = isBuy ? s.swingLows[s.swingLows.length - 1] : s.swingHighs[s.swingHighs.length - 1];
  if (pivot) {
    out.push({
      direction,
      stop: isBuy ? pivot.price - buffer : pivot.price + buffer,
      model: "TREND_CONTINUATION",
      origin: `protected ${isBuy ? "low" : "high"} at ${pivot.price.toFixed(2)}`,
    });
  }

  // 4. Breakout retest — protect beyond the broken level.
  const bos = s.events.find((e) => e.type === "BOS" && e.direction === wanted);
  if (bos) {
    out.push({
      direction,
      stop: isBuy ? bos.price - buffer : bos.price + buffer,
      model: "BREAKOUT_RETEST",
      origin: `BOS level ${bos.price.toFixed(2)}`,
    });
  }

  return out;
}

/**
 * Build the best structure-derived proposal for this bar, or null when no
 * GoldMind model is fully satisfied. Pure and deterministic.
 */
export function proposeFromStructure(i: ProposalInput): ReplayProposal | null {
  const price = i.structure.lastPrice ?? i.candles[i.candles.length - 1]?.c ?? null;
  if (!price || !Number.isFinite(price)) return null;

  const minStopPct = i.minStopPct ?? 0.0003;
  const maxStopPct = i.maxStopPct ?? 0.025;

  // Direction order is deterministic: the higher-timeframe read is examined
  // first, then the opposite side (reversal models live there).
  const htf = verdictDirection(i.mtf?.htf.verdict ?? "NEUTRAL");
  const order: Direction[] = htf === "bearish" ? ["SELL", "BUY"] : ["BUY", "SELL"];

  const sessionSweep = sessionSweepFor(i.liquidity);

  for (const direction of order) {
    for (const candidate of buildCandidates(i, direction)) {
      const isBuy = direction === "BUY";
      const stop = Number(candidate.stop.toFixed(2));
      const valid = isBuy ? stop < price : stop > price;
      if (!valid) continue;

      const risk = Math.abs(price - stop);
      const stopPct = risk / price;
      if (stopPct < minStopPct || stopPct > maxStopPct) continue;

      const targets = TARGET_R_MULTIPLES.map((m) =>
        Number((isBuy ? price + risk * m : price - risk * m).toFixed(2)),
      );

      const classification = classifySetup({
        proposal: { direction, entry: price, stop_loss: stop, take_profit_1: targets[0] },
        entryStructure: i.structure,
        mtf: i.mtf,
        sessionSweep: sessionSweep
          ? { side: sessionSweep.side, reclaimed: sessionSweep.reclaimed, t: sessionSweep.t }
          : null,
        atr: i.atr,
        now: i.now,
      });

      if (!classification.tradable) continue;
      if (classification.best?.type !== candidate.model) {
        // The classifier named a different model than the geometry was built
        // for. Accept it — the name comes from measured structure — but keep
        // the classifier's verdict authoritative.
      }

      return {
        direction,
        entry: Number(price.toFixed(2)),
        stop_loss: stop,
        take_profit_1: targets[0],
        take_profit_2: targets[1],
        take_profit_3: targets[2],
        risk_reward: TARGET_R_MULTIPLES[0],
        model: classification.best?.type ?? candidate.model,
        classification,
        origin: candidate.origin,
      };
    }
  }

  return null;
}
