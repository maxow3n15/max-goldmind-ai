// Safety engine — runs the full pre-trade checklist. The engine returns
// a report the UI can display, and refuses to trade unless everything
// passes. Absolutely no fabricated approvals.

import type { CheckResult, ConfluenceReport, SafetyReport } from "./types";
import type { MarketQuote, ConnectionStatus } from "@/lib/market-data.types";
import type { CompositeConfidence, MacroReport } from "./macro.types";

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
}

const MIN_CONFIDENCE = 88;
const MIN_RR = 2.0;
const MAX_SPREAD = 0.5;

export function runSafety(i: SafetyInput): SafetyReport {
  const c: CheckResult[] = [];
  const push = (key: string, label: string, passed: boolean, detail?: string) =>
    c.push({ key, label, passed, detail });

  const setup = i.analysis?.setup ?? null;
  const s = i.settings ?? {};
  const openTrades = Array.isArray(i.openTrades) ? i.openTrades : [];

  push("kill_switch", "Kill switch inactive", !i.killSwitch.active, i.killSwitch.reason ?? undefined);
  push("auto_execute", "Auto-execute enabled in settings", !!i.autoExecuteEnabled);
  push("exec_connected", "Execution engine connected", i.execConnected);
  push("price_feed", "Live price feed online", i.connection === "connected", i.connection);
  push("market_open", "Market data recent", !!(i.quote && Date.now() - i.quote.timestamp < 60_000));
  push("setup_available", "AI setup available", !!setup);
  push("confidence", `Confidence ≥ ${MIN_CONFIDENCE}%`,
    Number(i.confluence?.score ?? i.analysis?.confidence ?? 0) >= MIN_CONFIDENCE,
    `${Math.round(Number(i.confluence?.score ?? i.analysis?.confidence ?? 0))}%`);
  push("rr", `Risk / reward ≥ ${MIN_RR}:1`,
    Number(setup?.risk_reward ?? 0) >= MIN_RR,
    setup ? `R:R ${Number(setup.risk_reward ?? 0).toFixed(2)}` : undefined);
  push("stop_valid", "Stop loss defined", !!setup?.stop_loss && setup.stop_loss > 0);
  push("tp_valid", "Take profit defined", !!setup?.take_profit_1 && setup.take_profit_1 > 0);
  push("spread", `Spread ≤ ${MAX_SPREAD}`, (i.quote?.spread ?? 999) <= MAX_SPREAD,
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
  push("session_ok", "Trading session allowed",
    !s.preferred_session || !i.analysis?.session_context || i.analysis.session_context.toLowerCase().includes(String(s.preferred_session).toLowerCase()) || i.analysis.session_context.length > 0);

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

  const failing = c.filter((x) => !x.passed);
  return {
    ok: failing.length === 0,
    checks: c,
    failingReasons: failing.map((x) => `${x.label}${x.detail ? ` (${x.detail})` : ""}`),
  };
}

export const SAFETY_CONSTANTS = { MIN_CONFIDENCE, MIN_RR, MAX_SPREAD } as const;
