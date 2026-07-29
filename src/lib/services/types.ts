// Core service contracts for the autonomous trading system.
//
// Everything the engine touches goes through one of these interfaces so
// swapping the Paper execution engine for a real MT5 connector later is
// a single-file change and does not ripple into the UI.

import type { MarketQuote } from "@/lib/market-data.types";

export type Direction = "BUY" | "SELL";

export interface TradePlan {
  direction: Direction;
  entry: number;
  stop_loss: number;
  take_profit_1: number;
  take_profit_2?: number | null;
  take_profit_3?: number | null;
  lot_size: number;
  risk_reward: number;
  confidence: number;
  timeframe: string;
  session: string;
  reason: string;
  ai_analysis: unknown;
}

export interface CheckResult {
  key: string;
  label: string;
  passed: boolean;
  detail?: string;
  weight?: number; // used by confidence engine
}

export interface SafetyReport {
  ok: boolean;
  checks: CheckResult[];
  failingReasons: string[];
}

export interface ConfluenceReport {
  score: number;                 // 0..100 (matches AI confidence when available)
  supporting: string[];          // reasons that raise confidence
  detracting: string[];          // reasons that reduce confidence
  breakdown: CheckResult[];      // weighted confluences
}

export type EngineMode = "paper" | "mt5";

// Every executor speaks the same shape. The Paper executor writes to the
// database; the MT5 executor is intentionally an unimplemented placeholder.
export interface ExecutionEngine {
  readonly mode: EngineMode;
  readonly connected: boolean;
  submit(plan: TradePlan): Promise<{ id: string; broker_id?: string | null }>;
  closeAtPrice(id: string, price: number, reason: string): Promise<{ pnl: number }>;
  updateStops(id: string, patch: { stop_loss?: number }): Promise<void>;
}

export interface KillSwitchState {
  active: boolean;
  reason: string | null;
  since: number | null;
}

export interface AutopilotEvent {
  id: string;
  ts: number;
  level: "info" | "warn" | "error" | "success";
  message: string;
  detail?: string;
}

export interface AutopilotCycleContext {
  quote: MarketQuote | null;
  analysis: any | null;
  safety: SafetyReport | null;
  confluence: ConfluenceReport | null;
  lastPlan: TradePlan | null;
  lastRejection: string | null;
}
