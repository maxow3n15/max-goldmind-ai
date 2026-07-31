// useAutopilot — the autonomous orchestrator.
//
// Runs entirely client-side while the Autopilot page is open. It:
//   1. Watches the live market feed.
//   2. Every N seconds (or on price drift) runs AI analysis.
//   3. Computes weighted confluence + full safety report.
//   4. If enabled AND every safety check passes → submits a paper trade
//      via the ExecutionEngine.
//   5. On every tick, evaluates every OPEN trade through the position
//      manager and moves stops or closes as needed.
//   6. Maintains a kill-switch and an in-memory event log.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useMarketData } from "@/hooks/useMarketData";
import { analyzeMarket } from "@/lib/ai.functions";
import { getAccountSnapshot, listTrades, openPaperTrade, closePaperTrade } from "@/lib/trades.functions";
import { getUserSettings } from "@/lib/settings.functions";
import { computeConfluence } from "@/lib/services/confidence";
import { runSafety, SAFETY_CONSTANTS } from "@/lib/services/safety";
import { evaluate as evaluatePosition, type OpenTrade } from "@/lib/services/position-manager";
import { updateTradeStop } from "@/lib/autopilot.functions";
import { getMacroIntel } from "@/lib/macro.functions";
import { getQuantIntel } from "@/lib/quant.functions";
import { computeComposite, sizeMultiplier } from "@/lib/services/scoring";
import { analyseSessions } from "@/lib/services/session-stats";
import { buildManagementPlan } from "@/lib/services/trade-management";
import { buildTradeReport, formatTradeReport } from "@/lib/services/trade-report";
import type { CompositeConfidence, MacroReport } from "@/lib/services/macro.types";
import type { QuantIntel } from "@/lib/services/quant.types";
import { buildLadderPlans, createPaperExecutionEngine, MAX_RISK_PER_LEG_PCT } from "@/lib/services/execution";
import type {
  AutopilotEvent,
  ConfluenceReport,
  Direction,
  KillSwitchState,
  SafetyReport,
  TradePlan,
} from "@/lib/services/types";
import { currentSession } from "@/lib/format";

interface Options {
  timeframe: string;
  analysisIntervalMs?: number;
}

export function useAutopilot({ timeframe, analysisIntervalMs = 60_000 }: Options) {
  const qc = useQueryClient();
  const market = useMarketData({ intervalMs: 3000 });

  const analyzeFn = useServerFn(analyzeMarket);
  const settingsFn = useServerFn(getUserSettings);
  const snapFn = useServerFn(getAccountSnapshot);
  const tradesFn = useServerFn(listTrades);

  const macroFn = useServerFn(getMacroIntel);
  const macroQuery = useQuery({
    queryKey: ["macro-intel"],
    queryFn: () => macroFn() as Promise<MacroReport>,
    refetchInterval: 5 * 60_000,
    staleTime: 4 * 60_000,
  });
  const macro = (macroQuery.data ?? null) as MacroReport | null;

  const settings = useQuery({ queryKey: ["settings"], queryFn: () => settingsFn() });
  const snapshot = useQuery({ queryKey: ["snapshot"], queryFn: () => snapFn(), refetchInterval: 15_000 });
  const trades = useQuery({ queryKey: ["trades"], queryFn: () => tradesFn(), refetchInterval: 10_000 });

  const [running, setRunning] = useState(false);
  const [killSwitch, setKillSwitch] = useState<KillSwitchState>({ active: false, reason: null, since: null });
  const [events, setEvents] = useState<AutopilotEvent[]>([]);
  const [analysis, setAnalysis] = useState<any | null>(null);
  const [confluence, setConfluence] = useState<ConfluenceReport | null>(null);
  const [safety, setSafety] = useState<SafetyReport | null>(null);
  const [lastRejection, setLastRejection] = useState<string | null>(null);
  const [lastPlan, setLastPlan] = useState<TradePlan | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [composite, setComposite] = useState<CompositeConfidence | null>(null);
  const [lastReport, setLastReport] = useState<string | null>(null);

  const tradeRows = useMemo(() => (Array.isArray(trades.data) ? trades.data : []), [trades.data]);

  const openFn = useServerFn(openPaperTrade);
  const closeFn = useServerFn(closePaperTrade);
  const patchStopFn = useServerFn(updateTradeStop);
  const executor = useMemo(
    () => createPaperExecutionEngine({ open: openFn, close: closeFn, patchStop: patchStopFn }),
    [openFn, closeFn, patchStopFn],
  );
  const inFlightRef = useRef(false);
  const lastAnalyseRef = useRef(0);
  const lastAnalysedPriceRef = useRef<number | null>(null);
  const managedRef = useRef<Set<string>>(new Set());

  const log = useCallback((level: AutopilotEvent["level"], message: string, detail?: string) => {
    setEvents((prev) => {
      const next: AutopilotEvent = {
        id: crypto.randomUUID(),
        ts: Date.now(),
        level, message, detail,
      };
      return [next, ...prev].slice(0, 100);
    });
  }, []);

  const triggerKillSwitch = useCallback((reason: string) => {
    setKillSwitch({ active: true, reason, since: Date.now() });
    setRunning(false);
    log("error", "Kill switch triggered", reason);
    toast.error(`Autopilot stopped: ${reason}`);
  }, [log]);

  const resetKillSwitch = useCallback(() => {
    setKillSwitch({ active: false, reason: null, since: null });
    log("info", "Kill switch cleared");
  }, [log]);

  // Consecutive losses (from most recent closed trades).
  const consecutiveLosses = useMemo(() => {
    const closed = tradeRows.filter((t: any) => t.status === "closed" && t.pnl != null)
      .sort((a: any, b: any) => new Date(b.closed_at).getTime() - new Date(a.closed_at).getTime());
    let n = 0;
    for (const t of closed) {
      if (Number(t.pnl) < 0) n += 1; else break;
    }
    return n;
  }, [tradeRows]);

  const todayTradeCount = useMemo(() => {
    const day = new Date(); day.setUTCHours(0, 0, 0, 0);
    return tradeRows.filter((t: any) => new Date(t.opened_at) >= day).length;
  }, [tradeRows]);

  const openTrades: OpenTrade[] = useMemo(() =>
    tradeRows.filter((t: any) => t.status === "open").map((t: any) => ({
      id: t.id,
      direction: t.direction,
      entry_price: Number(t.entry_price),
      stop_loss: Number(t.stop_loss),
      take_profit_1: t.take_profit_1 != null ? Number(t.take_profit_1) : null,
      take_profit_2: t.take_profit_2 != null ? Number(t.take_profit_2) : null,
      take_profit_3: t.take_profit_3 != null ? Number(t.take_profit_3) : null,
      lot_size: Number(t.lot_size),
      opened_at: t.opened_at,
    })), [tradeRows]);

  // --- Auto kill-switch triggers on data changes ---
  useEffect(() => {
    if (killSwitch.active || !running) return;
    if (consecutiveLosses >= 3) triggerKillSwitch("3 consecutive losses");
  }, [consecutiveLosses, running, killSwitch.active, triggerKillSwitch]);

  useEffect(() => {
    if (killSwitch.active || !running || !snapshot.data) return;
    const bal = Number(snapshot.data?.account?.balance ?? 1) || 1;
    const s: any = settings.data ?? {};
    const dailyLossPct = -Math.min(0, Number(snapshot.data?.daily_pnl ?? 0)) / bal * 100;
    const weeklyLossPct = -Math.min(0, Number(snapshot.data?.weekly_pnl ?? 0)) / bal * 100;
    if (dailyLossPct >= Number(s.max_daily_loss ?? 3)) triggerKillSwitch(`Daily loss ${dailyLossPct.toFixed(2)}% reached`);
    else if (weeklyLossPct >= Number(s.max_weekly_loss ?? 6)) triggerKillSwitch(`Weekly loss ${weeklyLossPct.toFixed(2)}% reached`);
  }, [snapshot.data, settings.data, running, killSwitch.active, triggerKillSwitch]);

  useEffect(() => {
    if (killSwitch.active || !running) return;
    if (market.status === "disconnected") triggerKillSwitch("Live price feed disconnected");
  }, [market.status, running, killSwitch.active, triggerKillSwitch]);

  // --- Analysis loop ---
  const runAnalysisNow = useCallback(async () => {
    if (analysing) return;
    if (!market.quote?.mid) return;
    setAnalysing(true);
    try {
      const res: any = await analyzeFn({ data: { timeframe, session: currentSession(), price: market.quote.mid } });
      setAnalysis(res);
      const conf = computeConfluence({
        analysis: res,
        htfBias: res?.bias ?? null,
        spread: market.quote?.spread ?? null,
      });
      setConfluence(conf);
      lastAnalysedPriceRef.current = market.quote.mid;
      lastAnalyseRef.current = Date.now();
      log("info", `Analysis refreshed — ${res?.bias ?? "?"} · ${conf.score}% confluence`);
    } catch (e: any) {
      log("error", "Analysis failed", e?.message);
    } finally {
      setAnalysing(false);
    }
  }, [analyzeFn, market.quote?.mid, market.quote?.spread, timeframe, analysing, log]);

  // Cadence: every analysisIntervalMs, or when price drifts > 0.15%.
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => {
      const since = Date.now() - lastAnalyseRef.current;
      const price = market.quote?.mid;
      const last = lastAnalysedPriceRef.current;
      const drift = price && last ? Math.abs(price - last) / last : 0;
      if (since >= analysisIntervalMs || drift > 0.0015) runAnalysisNow();
    }, 5000);
    return () => window.clearInterval(t);
  }, [running, analysisIntervalMs, runAnalysisNow, market.quote?.mid]);

  // --- Risk-condition score (0..100) feeding the composite engine ---
  const riskScore = useMemo(() => {
    const s: any = settings.data ?? {};
    const bal = Number(snapshot.data?.account?.balance ?? 1) || 1;
    const dailyLossPct = -Math.min(0, Number(snapshot.data?.daily_pnl ?? 0)) / bal * 100;
    const maxDaily = Number(s.max_daily_loss ?? 3) || 3;
    const maxOpen = Number(s.max_open_trades ?? 3) || 3;
    let score = 100;
    score -= Math.min(40, (dailyLossPct / maxDaily) * 40);
    score -= Math.min(20, (openTrades.length / maxOpen) * 20);
    score -= consecutiveLosses * 10;
    if ((market.quote?.spread ?? 0) > 0.4) score -= 10;
    if (market.status !== "connected") score -= 30;
    return Math.max(0, Math.round(score));
  }, [settings.data, snapshot.data, openTrades.length, consecutiveLosses, market.quote?.spread, market.status]);

  // --- Composite confidence: technical + news + sentiment + risk ---
  useEffect(() => {
    setComposite(computeComposite({ confluence, analysis, macro, riskScore }));
  }, [confluence, analysis, macro, riskScore]);

  // --- Safety recompute whenever any input changes ---
  useEffect(() => {
    const report = runSafety({
      analysis,
      confluence,
      quote: market.quote,
      connection: market.status,
      settings: settings.data,
      snapshot: snapshot.data,
      openTrades,
      todayTradeCount,
      consecutiveLosses,
      killSwitch: { active: killSwitch.active, reason: killSwitch.reason },
      autoExecuteEnabled: !!settings.data?.auto_execute,
      execConnected: executor.connected,
      macro,
      composite,
    });
    setSafety(report);
  }, [analysis, confluence, market.quote, market.status, settings.data, snapshot.data,
      openTrades, todayTradeCount, consecutiveLosses, killSwitch, executor.connected, macro, composite]);

  // --- Submit trade when everything aligns ---
  useEffect(() => {
    if (!running || killSwitch.active) return;
    if (!safety?.ok || !analysis?.setup || !market.quote) return;
    if (inFlightRef.current) return;

    // Prevent duplicate submissions on the same setup snapshot.
    const setup = analysis.setup;
    const sigKey = `${setup.direction}:${setup.entry}:${setup.stop_loss}:${setup.take_profit_1}`;
    if (managedRef.current.has(sigKey)) return;

    const balance = Number(snapshot.data?.account?.balance ?? 10000);
    // Risk is minimised: at most 0.5% per leg (and never more than the
    // user's configured risk-per-trade setting).
    const mult = composite ? sizeMultiplier(macro, composite) : 1;
    const riskPctPerLeg = Number((Math.min(
      MAX_RISK_PER_LEG_PCT,
      Number(settings.data?.risk_per_trade ?? MAX_RISK_PER_LEG_PCT),
    ) * mult).toFixed(3));

    const base = {
      direction: setup.direction,
      entry: Number(setup.entry),
      stop_loss: Number(setup.stop_loss),
      take_profit_2: null,
      take_profit_3: null,
      confidence: Number(composite?.final ?? confluence?.score ?? analysis.confidence ?? 0),
      timeframe,
      session: currentSession(),
      reason: analysis.explanation ?? "Autopilot",
      ai_analysis: { ...analysis, macro, composite },
    };

    const plans = buildLadderPlans({
      base,
      targets: [setup.take_profit_1, setup.take_profit_2, setup.take_profit_3]
        .filter((t: any) => t != null)
        .map((t: any) => Number(t)),
      balance,
      riskPctPerLeg,
    });

    if (plans.length === 0) return;

    // Respect the max-open-trades ceiling: only take as many legs as fit.
    const room = Math.max(0, Number(settings.data?.max_open_trades ?? 3) - openTrades.length);
    const toOpen = plans.slice(0, room);
    if (toOpen.length === 0) return;

    inFlightRef.current = true;
    managedRef.current.add(sigKey);
    setLastPlan(toOpen[0]);

    if (composite) {
      const report = buildTradeReport({ plan: toOpen[0], analysis, confluence, macro, composite });
      const text = formatTradeReport(report);
      setLastReport(text);
      log("info", `Trade report — ${report.direction} @ ${report.entry.toFixed(2)} · ${report.confidence}% confidence`, text);
    }

    (async () => {
      for (const [i, plan] of toOpen.entries()) {
        try {
          await executor.submit(plan);
          log("success",
            `Opened ${plan.direction} leg ${i + 1}/${toOpen.length} @ ${plan.entry.toFixed(2)} · ${plan.lot_size} lots → TP ${plan.take_profit_1.toFixed(2)}`,
            `Risk ${riskPctPerLeg}% · Confidence ${plan.confidence}% · R:R ${plan.risk_reward.toFixed(2)}`);
        } catch (e: any) {
          log("error", `Leg ${i + 1} rejected by execution engine`, e?.message);
        }
      }
      toast.success(`Autopilot opened ${toOpen.length} paper trade${toOpen.length > 1 ? "s" : ""}`);
      qc.invalidateQueries({ queryKey: ["trades"] });
      qc.invalidateQueries({ queryKey: ["snapshot"] });
      inFlightRef.current = false;
    })();
  }, [running, killSwitch.active, safety, analysis, market.quote, snapshot.data,
      settings.data, confluence, timeframe, executor, log, qc, openTrades, composite, macro]);

  // Track rejection reasons for the UI (only when a setup exists and we
  // would have wanted to trade but couldn't).
  useEffect(() => {
    if (!analysis?.setup) { setLastRejection(null); return; }
    if (!safety) return;
    setLastRejection(safety.ok ? null : safety.failingReasons[0] ?? null);
  }, [safety, analysis?.setup]);

  // --- Autonomous position management on every price tick ---
  useEffect(() => {
    if (!market.quote?.mid || openTrades.length === 0) return;
    const price = market.quote.mid;
    for (const t of openTrades) {
      const action = evaluatePosition({ trade: t, price });
      if (action.type === "none") continue;
      const dedupeKey = `${t.id}:${action.type}:${"new_stop" in action ? action.new_stop : "close"}`;
      if (managedRef.current.has(dedupeKey)) continue;
      managedRef.current.add(dedupeKey);
      if (action.type === "close") {
        executor.closeAtPrice(t.id, action.price, action.reason)
          .then((r) => {
            log("success", `Closed ${t.direction} @ ${action.price.toFixed(2)}`,
              `${action.reason} · P&L $${r.pnl.toFixed(2)}`);
            qc.invalidateQueries({ queryKey: ["trades"] });
            qc.invalidateQueries({ queryKey: ["snapshot"] });
          })
          .catch((e) => log("error", "Close failed", e?.message));
      } else if (action.type === "move_stop") {
        executor.updateStops(t.id, { stop_loss: action.new_stop })
          .then(() => {
            log("info", `Stop → ${action.new_stop.toFixed(2)}`, action.reason);
            qc.invalidateQueries({ queryKey: ["trades"] });
          })
          .catch((e) => log("error", "Stop update failed", e?.message));
      }
    }
  }, [market.quote?.mid, openTrades, executor, log, qc]);

  const start = useCallback(() => {
    if (killSwitch.active) {
      toast.error("Clear the kill switch before restarting.");
      return;
    }
    setRunning(true);
    log("info", "Autopilot started");
    runAnalysisNow();
  }, [killSwitch.active, log, runAnalysisNow]);

  const stop = useCallback(() => {
    setRunning(false);
    log("warn", "Autopilot paused by user");
  }, [log]);

  return {
    running, killSwitch, events, analysis, confluence, safety,
    macro, macroLoading: macroQuery.isLoading, refreshMacro: () => macroQuery.refetch(),
    composite, lastReport, riskScore,
    lastRejection, lastPlan, analysing, market, snapshot: snapshot.data,
    settings: settings.data, openTrades, executor,
    consecutiveLosses, todayTradeCount,
    start, stop, runAnalysisNow, triggerKillSwitch, resetKillSwitch,
    constants: SAFETY_CONSTANTS,
  };
}
