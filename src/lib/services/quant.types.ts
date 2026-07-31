// Contracts for the quantitative analysis modules (volume, volatility,
// momentum, candle quality, correlation, session intelligence).
//
// Every module returns a 0..100 score where 50 is neutral, plus a short
// list of human-readable notes so the dashboard can explain the decision.

import type { Direction } from "./types";

export interface ModuleScore {
  /** 0..100, 50 = neutral. Directional modules are scored FOR the setup. */
  score: number;
  notes: string[];
  /** true when the module could not be computed (missing data). */
  degraded?: boolean;
}

export interface VolumeReport extends ModuleScore {
  relative_volume: number | null;      // current vs 20-period average
  volume_ma_20: number | null;
  volume_ma_50: number | null;
  spike: boolean;
  pullback_volume_declining: boolean;
  continuation_volume_rising: boolean;
  exhaustion: boolean;
  participation: "strong" | "healthy" | "weak";
}

export interface VolatilityReport extends ModuleScore {
  atr: number | null;
  atr_pct: number | null;              // ATR as % of price
  atr_expanding: boolean;
  atr_contracting: boolean;
  historical_vol: number | null;
  adr: number | null;                  // average daily range
  adr_used_pct: number | null;         // % of ADR already travelled today
  session_volatility: number | null;
  percentile: number | null;           // ATR percentile vs recent history
  regime: "trend" | "range" | "transition";
  extended_move: boolean;              // just after an outsized impulse
  /** Suggested stop distance in price units, derived from ATR. */
  suggested_stop_distance: number | null;
}

export interface MomentumReport extends ModuleScore {
  rsi: number | null;
  stoch_rsi: number | null;
  macd_histogram: number | null;
  macd_rising: boolean;
  adx: number | null;
  plus_di: number | null;
  minus_di: number | null;
  cci: number | null;
  roc: number | null;
  trend_strength: number;              // 0..100 from ADX
  deteriorating: boolean;              // momentum turning against the trade
}

export interface CandleQualityReport extends ModuleScore {
  body_pct: number | null;             // body / range
  upper_wick_pct: number | null;
  lower_wick_pct: number | null;
  patterns: string[];
  quality: "institutional" | "acceptable" | "indecisive";
}

export interface CorrelationLeg {
  symbol: string;
  label: string;
  change_pct: number | null;
  supports: boolean | null;            // supports the proposed gold direction
}

export interface CorrelationReport extends ModuleScore {
  legs: CorrelationLeg[];
  supporting: number;
  conflicting: number;
}

export interface SessionStat {
  session: string;
  trades: number;
  win_rate: number;
  avg_rr: number;
  avg_duration_minutes: number;
  net_pnl: number;
}

export interface SessionReport extends ModuleScore {
  current: string;
  stats: SessionStat[];
  current_stat: SessionStat | null;
  favoured: boolean;
}

/** Everything the server computes from candles, cached per timeframe. */
export interface QuantIntel {
  generated_at: number;
  timeframe: string;
  price: number | null;
  volume: VolumeReport;
  volatility: VolatilityReport;
  momentum: MomentumReport;
  candles: CandleQualityReport;
  correlation: CorrelationReport;
  degraded: boolean;
}

export interface ManagementRecommendation {
  break_even_at_r: number;
  partial_at_r: number;
  partial_fraction: number;
  trail_atr_multiple: number;
  suggested_stop_distance: number | null;
  hold_winner: boolean;
  early_exit: boolean;
  notes: string[];
}

export interface ConfidenceContribution {
  key: string;
  label: string;
  score: number;      // 0..100 module score
  weight: number;     // 0..1
  contribution: number; // score * weight, rounded
  notes: string[];
}

export type { Direction };
