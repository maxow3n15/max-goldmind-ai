// Safety engine — runs the full pre-trade checklist. The engine returns
// a report the UI can display, and refuses to trade unless everything
// passes. Absolutely no fabricated approvals.

import type { CheckResult, ConfluenceReport, SafetyReport } from "./types";
import type { MarketQuote, ConnectionStatus } from "@/lib/market-data.types";
import type { CompositeConfidence, MacroReport } from "./macro.types";
import type { ChallengeStatus } from "@/lib/challenge/engine";
import { classifyDataQuality, type DataQuality } from "./data-quality";
import { CONFIDENCE_GATES } from "./scoring";

export interface SafetyInput {
  analysis: any | null;
  confluence: ConfluenceReport | null;
  quote: MarketQuote | null;
  connection: ConnectionStatus;
  settings: any | null;
  snapshot: any | null;   // account snapshot
  openTrades: any[];
  todayTradeCount: number;
  consecutiveLosses: number;
  killSwitch: { active: boolean; reason: string | null };
  autoExecuteEnabled: boolean;
  execConnected: boolean;
  macro?: MacroReport | null;
  composite?: CompositeConfidence | null;
  /** Funded-account compliance, when a challenge account is being enforced. */
  challenge?: { enforced: boolean; status: ChallengeStatus | null } | null;
  /** Pre-computed feed verdict; derived from the quote when omitted. */
  dataQuality?: DataQuality | null;
  /** Deterministic structured confidence. Overrides any AI-reported number. */
  structuredConfidence?: number | null;
  /** Multi-timeframe agreement, 0..100. */
  mtfAlignment?: number | null;
}


/**
 * Hard floor for automated execution. A user may raise this in settings but
 * never lower it — the check below always takes the maximum of the two.
 */
// Single source of truth for the final confidence floor: scoring.ts.
const MIN_CONFIDENCE = CONFIDENCE_GATES.FINAL;
const MIN_RR = 2.0;
const MAX_SPREAD = 0.5;
/** Below this, the timeframes disagree too much to call it a clean read. */
const MIN_MTF_ALIGNMENT = 55;

const num = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export function runSafety(i: SafetyInput): SafetyReport {
  const c: CheckResult[] = [];
  const push = (key: string, label: string, passed: boolean, detail?: string) =>
    c.push({ key, label, passed, detail });

  const setup = i.analysis?.setup ?? null;
  const s = i.settings ?? {};
  const openTrades = Array.isArray(i.openTrades) ? i.openTrades : [];

  const minConfidence = Math.max(MIN_CONFIDENCE, num(s.confidence_threshold, MIN_CONFIDENCE));
  const minRr = Math.max(MIN_RR, num(s.min_risk_reward, MIN_RR));
  const maxSpread = Math.min(MAX_SPREAD, num(s.max_spread, MAX_SPREAD));
  const dq = i.dataQuality ?? classifyDataQuality(i.quote, i.connection);
  // The deterministic engine is authoritative; the AI's self-reported number
  // is only a fallback for display when the engine could not run.
  const confidence = Number(
    i.structuredConfidence ?? i.composite?.final ?? i.confluence?.score ?? i.analysis?.confidence ?? 0,
  );

  push("kill_switch", "Kill switch inactive", !i.killSwitch.active, i.killSwitch.reason ?? undefined);
  push("auto_execute", "Auto-execute enabled in settings", !!i.autoExecuteEnabled);
  push("exec_connected", "Execution engine connected", i.execConnected);
  push("price_feed", "Live price feed online", i.connection === "connected", i.connection);
  push("data_quality", "Market data tradable (LIVE/DELAYED)", dq.tradable, `${dq.status} · ${dq.detail}`);
  push("not_simulated", "Prices are real, not simulated", dq.status !== "SIMULATED", i.quote?.source);
  push("market_open", "Market data recent", !!(i.quote && Date.now() - i.quote.timestamp < 60_000));
  push("setup_available", "AI setup available", !!setup);
  push("confidence", `Confidence ≥ ${minConfidence}%`,
    confidence >= minConfidence,
    `${Math.round(confidence)}%`);
  push("mtf_alignment", `Timeframe agreement ≥ ${MIN_MTF_ALIGNMENT}%`,
    i.mtfAlignment == null ? false : i.mtfAlignment >= MIN_MTF_ALIGNMENT,
    i.mtfAlignment == null ? "multi-timeframe read unavailable" : `${Math.round(i.mtfAlignment)}%`);
  push("rr", `Risk / reward ≥ ${minRr}:1`,
    Number(setup?.risk_reward ?? 0) >= minRr,
    setup ? `R:R ${Number(setup.risk_reward ?? 0).toFixed(2)}` : undefined);
  push("stop_valid", "Stop loss defined", !!setup?.stop_loss && setup.stop_loss > 0);
  push("tp_valid", "Take profit defined", !!setup?.take_profit_1 && setup.take_profit_1 > 0);
  push("spread", `Spread ≤ ${maxSpread}`, (i.quote?.spread ?? 999) <= maxSpread,
    i.quote ? i.quote.spread.toFixed(2) : "no quote");
  push("max_open", `Open trades ≤ ${s.max_open_trades ?? 3}`,
    openTrades.length < (Number(s.max_open_trades ?? 3)));
  push("max_daily_trades", `Trades today ≤ ${s.max_trades_per_day ?? 5}`,
    i.todayTradeCount < (Number(s.max_trades_per_day ?? 5)));

  const bal = Number(i.snapshot?.account?.balance ?? 0) || 1;
  const dailyLossPct = -Math.min(0, Number(i.snapshot?.daily_pnl ?? 0)) / bal * 100;
  const weeklyLossPct = -Math.min(0, Number(i.snapshot?.weekly_pnl ?? 0)) / bal * 100;

  push("daily_loss", `Daily loss < ${s.max_daily_loss ?? 3}%`, dailyLossPct < Number(s.max_daily_loss ?? 3),
    `${dailyLossPct.toFixed(2)}%`);
  push("weekly_loss", `Weekly loss < ${s.max_weekly_loss ?? 6}%`, weeklyLossPct < Number(s.max_weekly_loss ?? 6),
    `${weeklyLossPct.toFixed(2)}%`);
  push("streak", "No 3-loss streak", i.consecutiveLosses < 3, `${i.consecutiveLosses} in a row`);
  push("news_filter", "News filter passed",
    !s.avoid_news || i.analysis?.news_risk !== "high",
    s.avoid_news ? "avoid-news enabled" : "disabled");
  const preferredSession = s.preferred_session ? String(s.preferred_session).toLowerCase() : "";
  const sessionContext = i.analysis?.session_context ? String(i.analysis.session_context).toLowerCase() : "";
  push("session_ok", "Trading session allowed",
    !preferredSession || (sessionContext.length > 0 && sessionContext.includes(preferredSession)),
    preferredSession ? `preferred ${preferredSession}${sessionContext ? ` / current ${sessionContext}` : " / no session context"}` : "no preference");

  // --- Fundamental / news intelligence gates ---
  if (i.composite) {
    for (const g of i.composite.gates) {
      push(`composite_${g.key}`, g.label, g.passed, g.detail);
    }
  }
  if (i.macro) {
    push("macro_feed_live", "Macro news feed live", !i.macro.degraded,
      i.macro.degraded ? "degraded — execution blocked" : `score ${i.macro.news_score}/100`);
    push("event_blackout", "No imminent high-impact event", !i.macro.blackout.active,
      i.macro.blackout.reason ?? undefined);
  } else {
    push("macro_feed_live", "Macro news feed live", false, "not loaded");
  }

  // --- Funded-account challenge compliance ---
  // Only enforced when the user is actually running a challenge account with
  // automatic enforcement enabled; otherwise the platform behaves exactly as
  // it did before.
  if (i.challenge?.enforced && i.challenge.status) {
    const cs = i.challenge.status;
    for (const g of cs.gates) {
      if (!g.hard && g.passed) continue;      // soft gates only surface when failing
      push(`challenge_${g.key}`, `Challenge · ${g.label}`, g.passed, g.detail);
    }
    push("challenge_budget", "Challenge risk budget available", cs.maxRiskPctForNextTrade > 0,
      `${cs.maxRiskPctForNextTrade}% of the account still spendable`);
    push("challenge_posture", "Challenge posture permits trading", cs.posture !== "lockdown", cs.posture);
  }

  const failing = c.filter((x) => !x.passed);

  return {
    ok: failing.length === 0,
    checks: c,
    failingReasons: failing.map((x) => `${x.label}${x.detail ? ` (${x.detail})` : ""}`),
  };
}

export const SAFETY_CONSTANTS = { MIN_CONFIDENCE, MIN_RR, MAX_SPREAD, MIN_MTF_ALIGNMENT } as const;

/** Resolve the effective (never-lowered) limits for a settings row. */
export function effectiveLimits(settings: any | null) {
  const s = settings ?? {};
  return {
    minConfidence: Math.max(MIN_CONFIDENCE, num(s.confidence_threshold, MIN_CONFIDENCE)),
    minRr: Math.max(MIN_RR, num(s.min_risk_reward, MIN_RR)),
    maxSpread: Math.min(MAX_SPREAD, num(s.max_spread, MAX_SPREAD)),
  };
}
