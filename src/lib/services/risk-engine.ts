// Advanced Risk Engine.
//
// One deterministic authority over "may we trade, and how big?". It is pure:
// no network, no React, no clock reads beyond the `now` passed in — which
// makes it reusable by the live engine AND the backtester.
//
// Layers, in order of severity:
//   1. Hard violations  → trading blocked outright.
//   2. Warnings         → allowed, but size is reduced.
//   3. Sizing           → volatility-normalised lot size, capped by every
//                         exposure limit that applies.

import type { Direction } from "./types";
import { identityConversion, validateConversion, type FxConversion } from "./fx";

export interface RiskLimits {
  riskPerTradePct: number;
  maxRiskPerTradePct: number;
  maxDailyLossPct: number;
  maxWeeklyLossPct: number;
  maxDrawdownPct: number;
  maxOpenTrades: number;
  maxTradesPerDay: number;
  maxTotalExposureLots: number;
  maxCorrelatedTrades: number;
  cooldownMinutes: number;
  recoveryModeEnabled: boolean;
}

export interface RiskPosition {
  id: string;
  direction: Direction;
  lot_size: number;
  entry_price: number;
  stop_loss: number;
}

/**
 * Contract specification for the traded symbol, as reported by the broker.
 *
 * Every field must come from the broker's own symbol/instrument endpoint —
 * nothing here may be guessed. When a connector cannot supply one, sizing is
 * refused rather than falling back to an assumed gold contract.
 */
export interface SymbolSpec {
  symbol: string;
  /** Units (e.g. troy ounces) per 1.0 lot. */
  contractSize: number;
  /** Smallest price increment the broker quotes. */
  tickSize: number;
  /**
   * Value of one tick for 1.0 lot, expressed in the ACCOUNT currency.
   * When the instrument's quote currency differs from the account currency
   * this value has already been converted with `conversion`.
   */
  tickValue: number;
  volumeMin: number;
  volumeMax: number;
  volumeStep: number;
  /** Fraction of notional required as margin (0.005 = 200:1). Null when unknown. */
  marginRate: number | null;
  /** Currency the instrument's P/L accrues in, from the broker (e.g. USD). */
  quoteCurrency: string;
  /** Currency the broker account is denominated in (e.g. GBP). */
  accountCurrency: string;
  /** Validated quote → account currency conversion behind `tickValue`. */
  conversion: FxConversion;
  /** Where the spec came from: connector id, or "simulation" for backtests. */
  source: string;
}

/** Money at risk per 1.0 lot for a given stop distance, from the broker spec. */
export function riskPerLot(spec: SymbolSpec, stopDistance: number): number {
  const valuePerPricePoint = spec.tickValue / spec.tickSize;
  return Math.abs(stopDistance) * valuePerPricePoint;
}

/** Round a volume DOWN to the broker's step, then clamp into [min, max]. */
export function roundVolumeToStep(volume: number, spec: SymbolSpec): number {
  const step = spec.volumeStep > 0 ? spec.volumeStep : spec.volumeMin;
  const decimals = Math.min(8, (String(step).split(".")[1] ?? "").length);
  const stepped = Math.floor(volume / step) * step;
  const rounded = Number(stepped.toFixed(decimals));
  if (rounded > spec.volumeMax) return Number(spec.volumeMax.toFixed(decimals));
  return rounded;
}

/** Why a spec is unusable, or null when it is safe to size from. */
export function specProblem(
  spec: SymbolSpec | null | undefined,
  now?: number,
): string | null {
  if (!spec) return "no broker symbol specification";
  const numeric: Array<[string, number | undefined]> = [
    ["contract size", spec.contractSize],
    ["tick size", spec.tickSize],
    ["tick value", spec.tickValue],
    ["minimum volume", spec.volumeMin],
    ["volume step", spec.volumeStep],
  ];
  for (const [label, v] of numeric) {
    if (!Number.isFinite(Number(v)) || Number(v) <= 0) return `broker did not report a usable ${label}`;
  }
  if (!Number.isFinite(spec.volumeMax) || spec.volumeMax < spec.volumeMin)
    return "broker did not report a usable maximum volume";
  if (!spec.quoteCurrency || !spec.accountCurrency) return "instrument or account currency is unknown";
  const conversion = spec.conversion;
  if (!conversion) return "no validated FX conversion for this instrument";
  if (conversion.from !== spec.quoteCurrency || conversion.to !== spec.accountCurrency)
    return `FX conversion ${conversion.from}→${conversion.to} does not match ${spec.quoteCurrency}→${spec.accountCurrency}`;
  const v = validateConversion(conversion, now ?? Date.now());
  if (!v.ok) return v.reason ?? "FX conversion could not be verified";
  return null;
}

export function isUsableSpec(
  spec: SymbolSpec | null | undefined,
  now?: number,
): spec is SymbolSpec {
  return specProblem(spec, now) === null;
}


export interface RiskInput {
  now: number;
  limits: RiskLimits;
  balance: number;
  equity: number;
  /** Highest equity ever reached — drives the drawdown calculation. */
  peakEquity: number;
  dailyPnl: number;
  weeklyPnl: number;
  openPositions: RiskPosition[];
  tradesToday: number;
  consecutiveLosses: number;
  /** Epoch ms of the most recent losing close, if any. */
  lastLossAt: number | null;
  spread: number | null;
  /** ATR of the trading timeframe in price units, for volatility sizing. */
  atr: number | null;
  feedHealthy: boolean;
  /** Proposed trade, when sizing is requested. */
  proposal?: { direction: Direction; entry: number; stop_loss: number } | null;
  /** Broker symbol specification. REQUIRED whenever `proposal` is supplied. */
  spec?: SymbolSpec | null;
}


export interface RiskViolation {
  key: string;
  label: string;
  detail: string;
  severity: "block" | "warn";
}

export interface RiskAssessment {
  /** 0..100 — higher is healthier. Feeds the composite confidence engine. */
  score: number;
  level: "normal" | "cautious" | "defensive" | "locked";
  allowed: boolean;
  violations: RiskViolation[];
  warnings: RiskViolation[];
  /** Multiplier applied to the base risk percentage (0.25 .. 1). */
  sizeMultiplier: number;
  /** Final risk budget for the next trade, as a % of balance. */
  effectiveRiskPct: number;
  /** Volatility-normalised lot size for the proposal, when one is supplied. */
  lotSize: number | null;
  /** Monetary risk recomputed from the ROUNDED lot size (account currency). */
  riskAmount: number | null;
  /** `riskAmount` as a % of balance, recomputed after rounding. */
  actualRiskPct: number | null;
  exposureLots: number;
  drawdownPct: number;
  dailyLossPct: number;
  weeklyLossPct: number;
  cooldownUntil: number | null;
  recoveryMode: boolean;
  notes: string[];
}

/**
 * Contract size used by the deterministic BACKTESTER only, where there is no
 * broker to query. Never use this for live or paper order sizing.
 */
export const GOLD_CONTRACT_SIZE = 100;

/** Explicit simulation spec for the backtester (not a broker fallback). */
export const SIMULATION_GOLD_SPEC: SymbolSpec = {
  symbol: "XAUUSD",
  contractSize: GOLD_CONTRACT_SIZE,
  tickSize: 0.01,
  tickValue: 0.01 * GOLD_CONTRACT_SIZE,
  volumeMin: 0.01,
  volumeMax: 100,
  volumeStep: 0.01,
  marginRate: null,
  quoteCurrency: "USD",
  accountCurrency: "USD",
  conversion: identityConversion("USD"),
  source: "simulation",
};


export const DEFAULT_RISK_LIMITS: RiskLimits = {
  riskPerTradePct: 0.5,
  maxRiskPerTradePct: 0.5,
  maxDailyLossPct: 3,
  maxWeeklyLossPct: 6,
  maxDrawdownPct: 10,
  maxOpenTrades: 3,
  maxTradesPerDay: 5,
  maxTotalExposureLots: 1,
  maxCorrelatedTrades: 2,
  cooldownMinutes: 15,
  recoveryModeEnabled: true,
};

/** Build limits from a raw user_settings row, falling back to safe defaults. */
export function limitsFromSettings(s: any | null | undefined): RiskLimits {
  const n = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const base = DEFAULT_RISK_LIMITS;
  return {
    riskPerTradePct: Math.min(n(s?.risk_per_trade, base.riskPerTradePct), n(s?.max_risk_per_trade_pct, base.maxRiskPerTradePct)),
    maxRiskPerTradePct: n(s?.max_risk_per_trade_pct, base.maxRiskPerTradePct),
    maxDailyLossPct: n(s?.max_daily_loss, base.maxDailyLossPct),
    maxWeeklyLossPct: n(s?.max_weekly_loss, base.maxWeeklyLossPct),
    maxDrawdownPct: n(s?.max_drawdown_pct, base.maxDrawdownPct),
    maxOpenTrades: n(s?.max_open_trades, base.maxOpenTrades),
    maxTradesPerDay: n(s?.max_trades_per_day, base.maxTradesPerDay),
    maxTotalExposureLots: n(s?.max_total_exposure_lots, base.maxTotalExposureLots),
    maxCorrelatedTrades: n(s?.max_correlated_trades, base.maxCorrelatedTrades),
    cooldownMinutes: n(s?.cooldown_minutes, base.cooldownMinutes),
    recoveryModeEnabled: s?.recovery_mode_enabled !== false,
  };
}

export function assessRisk(input: RiskInput): RiskAssessment {
  const { limits: L, now } = input;
  const violations: RiskViolation[] = [];
  const warnings: RiskViolation[] = [];
  const notes: string[] = [];

  const balance = input.balance > 0 ? input.balance : 1;
  const peak = Math.max(input.peakEquity || 0, input.equity || 0, balance);

  const dailyLossPct = (-Math.min(0, input.dailyPnl) / balance) * 100;
  const weeklyLossPct = (-Math.min(0, input.weeklyPnl) / balance) * 100;
  const drawdownPct = peak > 0 ? Math.max(0, ((peak - input.equity) / peak) * 100) : 0;
  const exposureLots = input.openPositions.reduce((a, p) => a + (Number(p.lot_size) || 0), 0);

  const block = (key: string, label: string, detail: string) =>
    violations.push({ key, label, detail, severity: "block" });
  const warn = (key: string, label: string, detail: string) =>
    warnings.push({ key, label, detail, severity: "warn" });

  // ---- Layer 1: hard limits -------------------------------------------
  if (dailyLossPct >= L.maxDailyLossPct)
    block("daily_loss", "Daily loss limit reached", `${dailyLossPct.toFixed(2)}% of ${L.maxDailyLossPct}%`);
  if (weeklyLossPct >= L.maxWeeklyLossPct)
    block("weekly_loss", "Weekly loss limit reached", `${weeklyLossPct.toFixed(2)}% of ${L.maxWeeklyLossPct}%`);
  if (drawdownPct >= L.maxDrawdownPct)
    block("drawdown", "Maximum drawdown reached", `${drawdownPct.toFixed(2)}% of ${L.maxDrawdownPct}%`);
  if (input.openPositions.length >= L.maxOpenTrades)
    block("max_open", "Open position limit reached", `${input.openPositions.length}/${L.maxOpenTrades}`);
  if (input.tradesToday >= L.maxTradesPerDay)
    block("max_daily_trades", "Daily trade count reached", `${input.tradesToday}/${L.maxTradesPerDay}`);
  if (exposureLots >= L.maxTotalExposureLots)
    block("exposure", "Total exposure limit reached", `${exposureLots.toFixed(2)}/${L.maxTotalExposureLots} lots`);
  if (input.consecutiveLosses >= 3)
    block("loss_streak", "Three consecutive losses", `${input.consecutiveLosses} in a row`);
  if (!input.feedHealthy)
    block("feed", "Price feed unhealthy", "risk cannot be measured without live prices");

  // Same-direction crowding: correlated exposure on a single instrument.
  if (input.proposal) {
    const sameDir = input.openPositions.filter((p) => p.direction === input.proposal!.direction).length;
    if (sameDir >= L.maxCorrelatedTrades)
      block("correlated", "Correlated position limit", `${sameDir} open ${input.proposal.direction} positions`);
  }

  // Cooldown after a loss — stops revenge trading.
  const cooldownUntil = input.lastLossAt != null ? input.lastLossAt + L.cooldownMinutes * 60_000 : null;
  if (cooldownUntil != null && now < cooldownUntil) {
    const mins = Math.ceil((cooldownUntil - now) / 60_000);
    block("cooldown", "Post-loss cooldown active", `${mins} min remaining`);
  }

  // ---- Layer 2: warnings that shrink size ------------------------------
  if (dailyLossPct >= L.maxDailyLossPct * 0.6)
    warn("daily_loss_near", "Approaching daily loss limit", `${dailyLossPct.toFixed(2)}%`);
  if (drawdownPct >= L.maxDrawdownPct * 0.5)
    warn("drawdown_near", "Drawdown above half the limit", `${drawdownPct.toFixed(2)}%`);
  if (input.consecutiveLosses > 0)
    warn("streak", "Recent losing trades", `${input.consecutiveLosses} consecutive`);
  if (input.spread != null && input.spread > 0.4)
    warn("spread", "Spread wider than normal", input.spread.toFixed(2));
  if (exposureLots > L.maxTotalExposureLots * 0.6)
    warn("exposure_near", "Exposure above 60% of limit", `${exposureLots.toFixed(2)} lots`);

  // ---- Layer 3: sizing --------------------------------------------------
  const recoveryMode =
    L.recoveryModeEnabled && (input.consecutiveLosses >= 2 || drawdownPct >= L.maxDrawdownPct * 0.5);

  let mult = 1;
  if (recoveryMode) { mult *= 0.5; notes.push("Recovery mode: position size halved until form recovers"); }
  if (input.consecutiveLosses === 1) mult *= 0.85;
  if (dailyLossPct >= L.maxDailyLossPct * 0.6) mult *= 0.7;
  if (drawdownPct >= L.maxDrawdownPct * 0.5) mult *= 0.7;
  if (input.spread != null && input.spread > 0.4) mult *= 0.85;
  // Scale down when the remaining daily loss budget is thinner than one full stop-out.
  const remainingDailyPct = Math.max(0, L.maxDailyLossPct - dailyLossPct);
  if (remainingDailyPct < L.riskPerTradePct * 2) {
    mult *= Math.max(0.25, remainingDailyPct / (L.riskPerTradePct * 2));
    notes.push("Daily loss budget nearly spent — risk scaled to what remains");
  }
  mult = Math.max(0.25, Math.min(1, Number(mult.toFixed(3))));

  const effectiveRiskPct = Number(
    Math.min(L.riskPerTradePct, L.maxRiskPerTradePct, remainingDailyPct || L.riskPerTradePct) * mult,
  );

  let lotSize: number | null = null;
  let riskAmount: number | null = null;
  let actualRiskPct: number | null = null;
  if (input.proposal) {
    const spec = input.spec;
    if (!isUsableSpec(spec, now)) {
      // Fail safe: no verified contract size / tick value / volume rules means
      // we cannot size the trade honestly. Never assume a gold contract.
      block(
        "symbol_spec",
        "Broker symbol specification unavailable",
        specProblem(spec, now) ?? "contract size, tick value and volume rules could not be sourced from the broker",
      );
    } else {
      const stopDistance = Math.abs(input.proposal.entry - input.proposal.stop_loss);
      if (stopDistance <= 0) {
        block("stop_distance", "Invalid stop distance", "entry and stop loss are identical");
      } else {
        const perLot = riskPerLot(spec, stopDistance);
        const budget = (balance * effectiveRiskPct) / 100;
        const raw = perLot > 0 ? budget / perLot : 0;

        // Never let one trade breach the remaining exposure headroom.
        const headroom = Math.max(0, L.maxTotalExposureLots - exposureLots);
        const capped = Math.min(raw, headroom, spec.volumeMax);
        const rounded = roundVolumeToStep(capped, spec);

        if (rounded < spec.volumeMin) {
          block(
            "min_volume",
            "Risk budget below broker minimum volume",
            `${rounded} lots < broker minimum ${spec.volumeMin}`,
          );
        } else {
          // Re-derive the true monetary risk from the ROUNDED volume — the
          // pre-rounding estimate is not what the broker will actually fill.
          const actual = rounded * perLot;
          const actualPct = (actual / balance) * 100;
          if (actualPct > L.maxRiskPerTradePct + 1e-9) {
            block(
              "risk_after_rounding",
              "Rounded position size exceeds max risk per trade",
              `${actualPct.toFixed(3)}% > ${L.maxRiskPerTradePct}% at ${rounded} lots`,
            );
          } else {
            lotSize = rounded;
            riskAmount = Number(actual.toFixed(2));
            actualRiskPct = Number(actualPct.toFixed(3));
          }
        }

        if (input.atr && input.atr > 0 && stopDistance < input.atr * 0.5) {
          // Flag stops that are unusually tight relative to current volatility.
          warn("tight_stop", "Stop is tight for current volatility", `${stopDistance.toFixed(2)} vs ATR ${input.atr.toFixed(2)}`);
        }
      }
    }
  }


  // ---- Health score -----------------------------------------------------
  let score = 100;
  score -= Math.min(35, (dailyLossPct / Math.max(L.maxDailyLossPct, 0.1)) * 35);
  score -= Math.min(25, (drawdownPct / Math.max(L.maxDrawdownPct, 0.1)) * 25);
  score -= Math.min(15, (exposureLots / Math.max(L.maxTotalExposureLots, 0.01)) * 15);
  score -= Math.min(15, input.consecutiveLosses * 7);
  if (!input.feedHealthy) score -= 30;
  if (input.spread != null && input.spread > 0.4) score -= 5;
  score = Math.max(0, Math.round(score));

  const allowed = violations.length === 0;
  const level: RiskAssessment["level"] =
    !allowed ? "locked" : recoveryMode ? "defensive" : warnings.length > 0 ? "cautious" : "normal";

  return {
    score, level, allowed, violations, warnings,
    sizeMultiplier: mult,
    effectiveRiskPct: Number(effectiveRiskPct.toFixed(3)),
    lotSize,
    riskAmount,
    actualRiskPct,

    exposureLots: Number(exposureLots.toFixed(2)),
    drawdownPct: Number(drawdownPct.toFixed(2)),
    dailyLossPct: Number(dailyLossPct.toFixed(2)),
    weeklyLossPct: Number(weeklyLossPct.toFixed(2)),
    cooldownUntil,
    recoveryMode,
    notes,
  };
}
