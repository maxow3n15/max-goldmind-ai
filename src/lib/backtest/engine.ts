// Historical simulation engine.
//
// Pure and deterministic: candles in, equity curve + metrics out. The same
// risk engine that guards live trading guards the simulation, so backtest
// results reflect the limits the account actually runs under.

import { atrSeries, emaSeries, rsiSeries, type Candle } from "@/lib/indicators";
import { assessRisk, GOLD_CONTRACT_SIZE, type RiskLimits } from "@/lib/services/risk-engine";
import type { Direction } from "@/lib/services/types";

export interface BacktestConfig {
  startingBalance: number;
  limits: RiskLimits;
  /** Round-trip cost in price units (spread + commission). */
  costPerTrade: number;
  rrTarget: number;
  atrStopMultiple: number;
  /** Only take signals in these UTC hour ranges. Empty = all hours. */
  sessions: Array<{ from: number; to: number }>;
  useTrailingStop: boolean;
  breakEvenAtR: number;
  minConfidence: number;
}

export const DEFAULT_BACKTEST_CONFIG: Omit<BacktestConfig, "limits"> = {
  startingBalance: 10_000,
  costPerTrade: 0.35,
  rrTarget: 2,
  atrStopMultiple: 1.5,
  sessions: [{ from: 7, to: 16 }],
  useTrailingStop: true,
  breakEvenAtR: 1,
  minConfidence: 76,
};

export interface SimTrade {
  index: number;
  openedAt: number;
  closedAt: number;
  direction: Direction;
  entry: number;
  stop: number;
  target: number;
  exit: number;
  lots: number;
  pnl: number;
  rMultiple: number;
  confidence: number;
  reason: string;
  exitReason: "target" | "stop" | "trail" | "timeout";
}

export interface EquityPoint { t: number; equity: number; drawdown: number }

export interface BacktestMetrics {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  returnPct: number;
  profitFactor: number;
  expectancyR: number;
  avgWin: number;
  avgLoss: number;
  maxDrawdownPct: number;
  maxDrawdown: number;
  sharpe: number;
  sortino: number;
  longestWinStreak: number;
  longestLossStreak: number;
  avgHoldBars: number;
  finalBalance: number;
  blockedByRisk: number;
}

export interface BacktestResult {
  metrics: BacktestMetrics;
  trades: SimTrade[];
  equityCurve: EquityPoint[];
  bars: number;
  from: number | null;
  to: number | null;
}

interface Signal { direction: Direction; confidence: number; reason: string }

/**
 * Rule-based mirror of the live confluence engine: trend (EMA stack),
 * momentum (RSI reset), and volatility expansion (ATR) must agree.
 */
function signalAt(
  i: number,
  candles: Candle[],
  ema20: number[], ema50: number[], ema200: number[], rsi: number[], atr: number[],
): Signal | null {
  const c = candles[i];
  const e20 = ema20[i], e50 = ema50[i], e200 = ema200[i], r = rsi[i], a = atr[i];
  if (![e20, e50, e200, r, a].every((v) => Number.isFinite(v))) return null;

  const supports: string[] = [];
  let score = 50;
  const bull = e20 > e50 && e50 > e200;
  const bear = e20 < e50 && e50 < e200;
  if (!bull && !bear) return null;
  const direction: Direction = bull ? "BUY" : "SELL";
  supports.push(`${bull ? "Bullish" : "Bearish"} EMA stack (20/50/200)`);
  score += 14;

  // Pullback into the fast average, then resumption.
  const prev = candles[i - 1];
  const pulled = bull ? prev.l <= e20 * 1.001 && c.c > e20 : prev.h >= e20 * 0.999 && c.c < e20;
  if (!pulled) return null;
  supports.push("Pullback into 20 EMA with resumption close");
  score += 12;

  // Momentum reset without exhaustion.
  if (bull && r > 45 && r < 72) { score += 10; supports.push(`RSI reset at ${r.toFixed(0)}`); }
  else if (bear && r < 55 && r > 28) { score += 10; supports.push(`RSI reset at ${r.toFixed(0)}`); }
  else return null;

  // Expansion candle in the trade direction.
  const body = Math.abs(c.c - c.o);
  const range = Math.max(1e-9, c.h - c.l);
  if (body / range > 0.55) { score += 8; supports.push("Strong directional candle body"); }
  if (a > 0 && body > a * 0.6) { score += 6; supports.push("Volatility expansion confirms intent"); }

  const slope = e50 - ema50[Math.max(0, i - 10)];
  if ((bull && slope > 0) || (bear && slope < 0)) { score += 6; supports.push("50 EMA slope aligned"); }

  return { direction, confidence: Math.min(97, score), reason: supports.join(" · ") };
}

function inSession(t: number, sessions: BacktestConfig["sessions"]): boolean {
  if (!sessions.length) return true;
  const h = new Date(t).getUTCHours();
  return sessions.some((s) => (s.from <= s.to ? h >= s.from && h < s.to : h >= s.from || h < s.to));
}

export function runBacktest(candles: Candle[], config: BacktestConfig): BacktestResult {
  const cfg = config;
  const closes = candles.map((c) => c.c);
  const ema20 = emaSeries(closes, 20);
  const ema50 = emaSeries(closes, 50);
  const ema200 = emaSeries(closes, 200);
  const rsi = rsiSeries(closes, 14);
  const atr = atrSeries(candles, 14);

  let balance = cfg.startingBalance;
  let peak = cfg.startingBalance;
  let maxDd = 0, maxDdPct = 0;
  let consecutiveLosses = 0;
  let lastLossAt: number | null = null;
  let tradesToday = 0;
  let currentDay = "";
  let dailyPnl = 0;
  let weeklyPnl = 0;
  let currentWeek = "";
  let blockedByRisk = 0;

  const trades: SimTrade[] = [];
  const equityCurve: EquityPoint[] = [];
  const start = Math.max(200, 20);

  let open: (SimTrade & { movedToBe: boolean }) | null = null;

  for (let i = start; i < candles.length; i++) {
    const c = candles[i];
    const dayKey = new Date(c.t).toISOString().slice(0, 10);
    const weekKey = `${new Date(c.t).getUTCFullYear()}-${Math.floor(new Date(c.t).getUTCDate() / 7)}-${new Date(c.t).getUTCMonth()}`;
    if (dayKey !== currentDay) { currentDay = dayKey; tradesToday = 0; dailyPnl = 0; }
    if (weekKey !== currentWeek) { currentWeek = weekKey; weeklyPnl = 0; }

    // ---- manage the open position first -------------------------------
    if (open) {
      const dir = open.direction === "BUY" ? 1 : -1;
      const rDist = Math.abs(open.entry - open.stop);

      // Break-even and trailing management, evaluated on the bar close.
      if (cfg.breakEvenAtR > 0 && !open.movedToBe && rDist > 0) {
        const moved = (c.c - open.entry) * dir;
        if (moved >= rDist * cfg.breakEvenAtR) { open.stop = open.entry; open.movedToBe = true; }
      }
      if (cfg.useTrailingStop && open.movedToBe && Number.isFinite(atr[i])) {
        const trail = open.direction === "BUY" ? c.c - atr[i] : c.c + atr[i];
        open.stop = open.direction === "BUY" ? Math.max(open.stop, trail) : Math.min(open.stop, trail);
      }

      // Stop is checked before target — the pessimistic assumption.
      const hitStop = open.direction === "BUY" ? c.l <= open.stop : c.h >= open.stop;
      const hitTarget = open.direction === "BUY" ? c.h >= open.target : c.l <= open.target;
      let exit: number | null = null;
      let exitReason: SimTrade["exitReason"] | null = null;
      if (hitStop) { exit = open.stop; exitReason = open.movedToBe ? "trail" : "stop"; }
      else if (hitTarget) { exit = open.target; exitReason = "target"; }
      else if (i - open.index > 96) { exit = c.c; exitReason = "timeout"; }

      if (exit != null && exitReason) {
        const gross = (exit - open.entry) * dir * open.lots * GOLD_CONTRACT_SIZE;
        const cost = cfg.costPerTrade * open.lots * GOLD_CONTRACT_SIZE;
        const pnl = Number((gross - cost).toFixed(2));
        const riskAmount = rDist * open.lots * GOLD_CONTRACT_SIZE;
        balance += pnl;
        dailyPnl += pnl;
        weeklyPnl += pnl;
        if (pnl < 0) { consecutiveLosses += 1; lastLossAt = c.t; } else { consecutiveLosses = 0; }
        trades.push({
          ...open,
          closedAt: c.t,
          exit,
          pnl,
          exitReason,
          rMultiple: riskAmount > 0 ? Number((pnl / riskAmount).toFixed(2)) : 0,
        });
        open = null;
      }
    }

    peak = Math.max(peak, balance);
    const dd = peak - balance;
    if (dd > maxDd) { maxDd = dd; maxDdPct = (dd / peak) * 100; }
    equityCurve.push({ t: c.t, equity: Number(balance.toFixed(2)), drawdown: Number(((dd / peak) * 100).toFixed(2)) });

    if (open || !inSession(c.t, cfg.sessions)) continue;

    // ---- look for a new entry -----------------------------------------
    const sig = signalAt(i, candles, ema20, ema50, ema200, rsi, atr);
    if (!sig || sig.confidence < cfg.minConfidence) continue;

    const a = atr[i];
    if (!Number.isFinite(a) || a <= 0) continue;
    const entry = c.c;
    const stop = sig.direction === "BUY" ? entry - a * cfg.atrStopMultiple : entry + a * cfg.atrStopMultiple;
    const target = sig.direction === "BUY"
      ? entry + a * cfg.atrStopMultiple * cfg.rrTarget
      : entry - a * cfg.atrStopMultiple * cfg.rrTarget;

    const risk = assessRisk({
      now: c.t,
      limits: cfg.limits,
      balance,
      equity: balance,
      peakEquity: peak,
      dailyPnl,
      weeklyPnl,
      openPositions: [],
      tradesToday,
      consecutiveLosses,
      lastLossAt,
      spread: cfg.costPerTrade,
      atr: a,
      feedHealthy: true,
      proposal: { direction: sig.direction, entry, stop_loss: stop },
    });

    if (!risk.allowed || !risk.lotSize) { blockedByRisk += 1; continue; }

    tradesToday += 1;
    open = {
      index: i,
      openedAt: c.t,
      closedAt: c.t,
      direction: sig.direction,
      entry,
      stop,
      target,
      exit: entry,
      lots: risk.lotSize,
      pnl: 0,
      rMultiple: 0,
      confidence: sig.confidence,
      reason: sig.reason,
      exitReason: "timeout",
      movedToBe: false,
    };
  }

  return {
    metrics: computeMetrics(trades, equityCurve, cfg.startingBalance, balance, maxDd, maxDdPct, blockedByRisk),
    trades,
    equityCurve: downsample(equityCurve, 400),
    bars: candles.length,
    from: candles.length ? candles[0].t : null,
    to: candles.length ? candles[candles.length - 1].t : null,
  };
}

function computeMetrics(
  trades: SimTrade[], curve: EquityPoint[], startBalance: number, finalBalance: number,
  maxDrawdown: number, maxDrawdownPct: number, blockedByRisk: number,
): BacktestMetrics {
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossWin = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));

  let winStreak = 0, lossStreak = 0, curWin = 0, curLoss = 0;
  for (const t of trades) {
    if (t.pnl > 0) { curWin++; curLoss = 0; } else { curLoss++; curWin = 0; }
    winStreak = Math.max(winStreak, curWin);
    lossStreak = Math.max(lossStreak, curLoss);
  }

  // Per-trade returns drive Sharpe/Sortino so the ratios stay comparable
  // between runs of different lengths.
  const rets = trades.map((t) => t.pnl / Math.max(1, startBalance));
  const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  const sd = rets.length > 1
    ? Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1)) : 0;
  const downside = rets.filter((r) => r < 0);
  const dsd = downside.length > 1
    ? Math.sqrt(downside.reduce((a, b) => a + b ** 2, 0) / downside.length) : 0;
  const ann = Math.sqrt(Math.max(1, rets.length));

  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? Number(((wins.length / trades.length) * 100).toFixed(1)) : 0,
    netPnl: Number((finalBalance - startBalance).toFixed(2)),
    returnPct: Number((((finalBalance - startBalance) / Math.max(1, startBalance)) * 100).toFixed(2)),
    profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : grossWin > 0 ? 99 : 0,
    expectancyR: trades.length
      ? Number((trades.reduce((a, t) => a + t.rMultiple, 0) / trades.length).toFixed(2)) : 0,
    avgWin: wins.length ? Number((grossWin / wins.length).toFixed(2)) : 0,
    avgLoss: losses.length ? Number((grossLoss / losses.length).toFixed(2)) : 0,
    maxDrawdown: Number(maxDrawdown.toFixed(2)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    sharpe: sd > 0 ? Number(((mean / sd) * ann).toFixed(2)) : 0,
    sortino: dsd > 0 ? Number(((mean / dsd) * ann).toFixed(2)) : 0,
    longestWinStreak: winStreak,
    longestLossStreak: lossStreak,
    avgHoldBars: trades.length
      ? Number((trades.reduce((a, t) => a + Math.max(1, (t.closedAt - t.openedAt) / 60_000), 0) / trades.length).toFixed(0))
      : 0,
    finalBalance: Number(finalBalance.toFixed(2)),
    blockedByRisk,
  };
}

function downsample(points: EquityPoint[], max: number): EquityPoint[] {
  if (points.length <= max) return points;
  const step = Math.ceil(points.length / max);
  const out: EquityPoint[] = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  const lastPoint = points[points.length - 1];
  if (out[out.length - 1]?.t !== lastPoint.t) out.push(lastPoint);
  return out;
}
