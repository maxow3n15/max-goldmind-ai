// Execution engines. Two implementations behind one interface:
//   1. PaperExecutionEngine — persists trades through server functions.
//   2. Mt5ExecutionEngine   — placeholder; intentionally NOT implemented.
//
// The orchestrator only ever talks to `ExecutionEngine`, so switching
// modes is a factory swap. We NEVER fake a successful live order.

import type { ExecutionEngine, TradePlan } from "./types";
import { openPaperTrade, closePaperTrade } from "@/lib/trades.functions";
import { updateTradeStop } from "@/lib/autopilot.functions";

type ServerCaller = (fn: any) => (...args: any[]) => any;

export function createPaperExecutionEngine(useSFn: ServerCaller): ExecutionEngine {
  const open = useSFn(openPaperTrade);
  const close = useSFn(closePaperTrade);
  const patchStop = useSFn(updateTradeStop);
  return {
    mode: "paper",
    connected: true,
    async submit(plan: TradePlan) {
      const row: any = await open({
        data: {
          direction: plan.direction,
          entry_price: plan.entry,
          stop_loss: plan.stop_loss,
          take_profit_1: plan.take_profit_1 ?? undefined,
          take_profit_2: plan.take_profit_2 ?? undefined,
          take_profit_3: plan.take_profit_3 ?? undefined,
          lot_size: plan.lot_size,
          confidence: plan.confidence,
          timeframe: plan.timeframe,
          session: plan.session,
          reason_entry: plan.reason,
          ai_analysis: plan.ai_analysis,
        },
      });
      return { id: row.id, broker_id: null };
    },
    async closeAtPrice(id, price, reason) {
      const res: any = await close({ data: { id, exit_price: price, reason_exit: reason } });
      return { pnl: Number(res?.pnl ?? 0) };
    },
    async updateStops(id, patch) {
      if (patch.stop_loss == null) return;
      await patchStop({ data: { id, stop_loss: patch.stop_loss } });
    },
  };
}

// Placeholder for a future MT5 bridge. This deliberately throws so the
// autopilot can never silently pretend a live order went through. When
// the real bridge exists it will implement the same interface.
export function createMt5ExecutionEngineStub(): ExecutionEngine {
  const unavailable = () => {
    throw new Error(
      "MT5 execution bridge not connected. Set VITE_TRADING_SERVER_URL and " +
      "deploy the external MT5 connector service to enable live execution.",
    );
  };
  return {
    mode: "mt5",
    connected: false,
    submit: unavailable,
    closeAtPrice: unavailable,
    updateStops: unavailable,
  };
}

// Hard cap on risk for any single autopilot leg (percent of balance).
export const MAX_RISK_PER_LEG_PCT = 0.5;

// Splits one AI setup into up to three independent trades — one per take
// profit level the AI produced. Each leg carries its own TP as TP1 so the
// position manager closes it at that target, and each leg risks at most
// MAX_RISK_PER_LEG_PCT of the balance.
export function buildLadderPlans(opts: {
  base: Omit<TradePlan, "lot_size" | "take_profit_1" | "risk_reward">;
  targets: number[];
  balance: number;
  riskPctPerLeg: number;
}): TradePlan[] {
  const { base, balance } = opts;
  const riskPct = Math.min(opts.riskPctPerLeg, MAX_RISK_PER_LEG_PCT);
  const risk = Math.abs(base.entry - base.stop_loss);
  const valid = opts.targets
    .filter((t) => Number.isFinite(t) && t > 0)
    .filter((t) => (base.direction === "BUY" ? t > base.entry : t < base.entry))
    .sort((a, b) => (base.direction === "BUY" ? a - b : b - a))
    .slice(0, 3);

  return valid.map((tp, idx) => ({
    ...base,
    take_profit_1: tp,
    take_profit_2: valid[idx + 1] ?? null,
    take_profit_3: valid[idx + 2] ?? null,
    risk_reward: risk > 0 ? +(Math.abs(tp - base.entry) / risk).toFixed(2) : 0,
    lot_size: computeLotSize({ balance, riskPct, entry: base.entry, stop_loss: base.stop_loss }),
    reason: `${base.reason} · TP${idx + 1} leg (${riskPct}% risk)`,
  }));
}

// Universal position-size calculator. Uses % of balance / stop distance.
// Assumes XAUUSD contract of 100 oz per 1.0 lot (industry standard).
export function computeLotSize(opts: {
  balance: number;
  riskPct: number;      // e.g. 1 = 1%
  entry: number;
  stop_loss: number;
  minLot?: number;
  maxLot?: number;
  step?: number;
}): number {
  const { balance, riskPct, entry, stop_loss } = opts;
  const riskUsd = Math.max(0, balance * (riskPct / 100));
  const dist = Math.abs(entry - stop_loss);
  if (dist <= 0 || riskUsd <= 0) return opts.minLot ?? 0.01;
  // XAUUSD: 1.0 lot = 100 oz → $100 per $1 move.
  const lots = riskUsd / (dist * 100);
  const step = opts.step ?? 0.01;
  const min = opts.minLot ?? 0.01;
  const max = opts.maxLot ?? 100;
  const rounded = Math.floor(lots / step) * step;
  return Math.max(min, Math.min(max, +rounded.toFixed(2)));
}
