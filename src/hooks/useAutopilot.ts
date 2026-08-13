// useAutopilot — the browser view of the autonomous engine.
//
// The decision logic itself no longer lives here: it lives in
// services/orchestrator.ts, which the scheduled server tick runs too. This
// hook is the client's I/O shell around that one implementation — it fetches
// the inputs, runs the pipeline, and executes what the pipeline decided.
//
//   1. Watches the live market feed.
//   2. Every N seconds (or on price drift) runs AI analysis.
//   3. Feeds everything to runDecisionPipeline().
//   4. Submits the ladder legs the pipeline produced.
//   5. Applies the position-manager actions the pipeline planned.
//   6. Reads and writes the durable kill switch on user_settings.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useMarketData } from "@/hooks/useMarketData";
import { analyzeMarket } from "@/lib/ai.functions";
import { getChallengeStatus } from "@/lib/challenge.functions";
import type { ChallengeStatus } from "@/lib/challenge/engine";

import { getAccountSnapshot, listTrades, openPaperTrade, closePaperTrade } from "@/lib/trades.functions";
import { getUserSettings, setKillSwitch as setKillSwitchFn } from "@/lib/settings.functions";
import { getLearningInsights } from "@/lib/learning.functions";
import { computeConfluence } from "@/lib/services/confidence";
import { SAFETY_CONSTANTS } from "@/lib/services/safety";
import { updateTradeStop } from "@/lib/autopilot.functions";
import { getMacroIntel } from "@/lib/macro.functions";
import { getQuantIntel } from "@/lib/quant.functions";
import { analyseSessions } from "@/lib/services/session-stats";
import { buildManagementPlan } from "@/lib/services/trade-management";
import { buildTradeReport, formatTradeReport } from "@/lib/services/trade-report";
import type { MacroReport } from "@/lib/services/macro.types";
import type { QuantIntel } from "@/lib/services/quant.types";
import { createPaperExecutionEngine, createLiveExecutionEngine } from "@/lib/services/execution";
import { classifyEnvironment, environmentKey } from "@/lib/services/environment";
import { runDecisionPipeline, planPositionActions } from "@/lib/services/orchestrator";
import { getMarketStructure } from "@/lib/structure.functions";
import { updateExcursion, excursionChanged } from "@/lib/services/forensics";
import { getForensics, recordExcursions } from "@/lib/forensics.functions";
import { recordHeartbeat } from "@/lib/heartbeat.functions";
import { listBrokerConnections, placeLiveOrder, closeLiveOrder, modifyLiveOrder } from "@/lib/brokers.functions";
import { bus, type DecisionSnapshot } from "@/engines/kernel/event-bus";
import { metrics } from "@/engines/kernel/metrics";

import type {
  AutopilotEvent,
  ConfluenceReport,
  Direction,
  KillSwitchState,
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

  const settings = useQuery({ queryKey: ["settings"], queryFn: () => settingsFn(), refetchInterval: 20_000 });
  const snapshot = useQuery({ queryKey: ["snapshot"], queryFn: () => snapFn(), refetchInterval: 15_000 });
  const trades = useQuery({ queryKey: ["trades"], queryFn: () => tradesFn(), refetchInterval: 10_000 });

  // Funded-account compliance. When no challenge account exists this stays
  // null and the engine behaves exactly as before.
  const challengeFn = useServerFn(getChallengeStatus);
  const challengeQuery = useQuery({
    queryKey: ["challenge-status", null],
    queryFn: () => challengeFn({ data: {} }),
    refetchInterval: 30_000,
  });
  const challengeProfile: any = challengeQuery.data?.profile ?? null;
  const challengeStatus = (challengeQuery.data?.status ?? null) as ChallengeStatus | null;
  const challengeEnforced = !!challengeProfile?.auto_enforce && challengeProfile?.status === "active" && !!challengeStatus;

  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<AutopilotEvent[]>([]);
  const [analysis, setAnalysis] = useState<any | null>(null);
  const [confluence, setConfluence] = useState<ConfluenceReport | null>(null);
  const [lastPlan, setLastPlan] = useState<TradePlan | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [lastReport, setLastReport] = useState<string | null>(null);

  const tradeRows = useMemo(() => (Array.isArray(trades.data) ? trades.data : []), [trades.data]);

  // --- Durable kill switch, read straight off user_settings -------------
  const settingsRow: any = settings.data ?? null;
  const killSwitch: KillSwitchState = useMemo(
    () => ({
      active: !!settingsRow?.kill_switch_active,
      reason: settingsRow?.kill_switch_reason ?? null,
      since: settingsRow?.kill_switch_since ? new Date(settingsRow.kill_switch_since).getTime() : null,
    }),
    [settingsRow?.kill_switch_active, settingsRow?.kill_switch_reason, settingsRow?.kill_switch_since],
  );

  // --- Quantitative intelligence: volume, volatility, momentum, candles, correlation ---
  const setupDirection: Direction | null = (analysis?.setup?.direction as Direction) ?? null;
  const quantFn = useServerFn(getQuantIntel);
  const quantQuery = useQuery({
    queryKey: ["quant-intel", timeframe, setupDirection],
    queryFn: () => quantFn({ data: { timeframe, direction: setupDirection } }) as Promise<QuantIntel>,
    refetchInterval: 60_000,
    staleTime: 45_000,
    placeholderData: (prev) => prev,
  });
  const quant = (quantQuery.data ?? null) as QuantIntel | null;

  // Session intelligence is pure statistics over the trader's own history.
  const sessionReport = useMemo(() => analyseSessions(tradeRows as any[], currentSession()), [tradeRows]);

  const management = useMemo(
    () => buildManagementPlan({ volatility: quant?.volatility, momentum: quant?.momentum }),
    [quant?.volatility, quant?.momentum],
  );

  // Execution destination: paper engine, or the user's connected broker.
  const openFn = useServerFn(openPaperTrade);
  const closeFn = useServerFn(closePaperTrade);
  const patchStopFn = useServerFn(updateTradeStop);
  const placeLiveFn = useServerFn(placeLiveOrder);
  const closeLiveFn = useServerFn(closeLiveOrder);
  const modifyLiveFn = useServerFn(modifyLiveOrder);
  const brokersFn = useServerFn(listBrokerConnections);
  const killSwitchServerFn = useServerFn(setKillSwitchFn);

  const brokersQuery = useQuery({
    queryKey: ["broker-connections"],
    queryFn: () => brokersFn(),
    refetchInterval: 30_000,
  });
  const defaultBroker = useMemo(() => {
    const rows: any[] = Array.isArray(brokersQuery.data) ? brokersQuery.data : [];
    return rows.find((r) => r.is_default) ?? null;
  }, [brokersQuery.data]);

  const tradingMode: "paper" | "live" = settingsRow?.trading_mode === "live" ? "live" : "paper";
  const spread = market.quote?.spread ?? null;

  const executor = useMemo(
    () =>
      tradingMode === "live"
        ? createLiveExecutionEngine({
            place: placeLiveFn,
            close: closeLiveFn,
            patchStop: modifyLiveFn,
            connected: !!defaultBroker && defaultBroker.status === "connected",
            spread,
          })
        : createPaperExecutionEngine({ open: openFn, close: closeFn, patchStop: patchStopFn }),
    [tradingMode, placeLiveFn, closeLiveFn, modifyLiveFn, defaultBroker, spread, openFn, closeFn, patchStopFn],
  );

  const inFlightRef = useRef(false);
  const lastAnalyseRef = useRef(0);
  const lastAnalysedPriceRef = useRef<number | null>(null);
  const managedRef = useRef<Set<string>>(new Set());
  const cycleRef = useRef<{ id: string; startedAt: number } | null>(null);
  const loggedCycleRef = useRef<string | null>(null);

  const log = useCallback((level: AutopilotEvent["level"], message: string, detail?: string) => {
    setEvents((prev) => {
      const next: AutopilotEvent = { id: crypto.randomUUID(), ts: Date.now(), level, message, detail };
      return [next, ...prev].slice(0, 100);
    });
  }, []);

  const triggerKillSwitch = useCallback(
    (reason: string) => {
      setRunning(false);
      log("error", "Kill switch triggered", reason);
      toast.error(`Autopilot stopped: ${reason}`);
      killSwitchServerFn({ data: { active: true, reason } })
        .then(() => qc.invalidateQueries({ queryKey: ["settings"] }))
        .catch(() => {});
    },
    [log, killSwitchServerFn, qc],
  );

  const resetKillSwitch = useCallback(() => {
    log("info", "Kill switch cleared");
    killSwitchServerFn({ data: { active: false, reason: null } })
      .then(() => qc.invalidateQueries({ queryKey: ["settings"] }))
      .catch(() => {});
  }, [log, killSwitchServerFn, qc]);

  // --- Forensics + calibration: how the engine has actually performed ---
  const forensicsFn = useServerFn(getForensics);
  const forensicsQuery = useQuery({
    queryKey: ["forensics"],
    queryFn: () => forensicsFn(),
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  // --- Environment-performance history ----------------------------------
  const learningFn = useServerFn(getLearningInsights);
  const learningQuery = useQuery({
    queryKey: ["learning-insights"],
    queryFn: () => learningFn(),
    refetchInterval: 300_000,
    staleTime: 240_000,
  });

  // --- Multi-timeframe structure ----------------------------------------
  // The browser engine reasons about exactly the structure the server tick
  // does; without it the timeframe-agreement gate can never pass.
  const structureFn = useServerFn(getMarketStructure);
  const structureQuery = useQuery({
    queryKey: ["market-structure", timeframe],
    queryFn: () => structureFn({ data: { timeframe } }),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
  const structure = (structureQuery.data as any) ?? null;
  const feedBroken = structure?.integrity?.status === "INVALID";

  const environment = useMemo(() => classifyEnvironment(quant, macro), [quant, macro]);
  const envKey = useMemo(() => environmentKey(environment), [environment]);

  const environmentTrackRecord = useMemo(() => {
    if (!envKey) return null;
    const rows: any[] = (learningQuery.data as any)?.by_environment ?? [];
    const hit = rows.find((r) => r.key === envKey);
    return hit ? { winRate: Number(hit.win_rate ?? 0), trades: Number(hit.trades ?? 0) } : null;
  }, [envKey, learningQuery.data]);

  // --- One decision per render, from the shared pipeline -----------------
  const decision = useMemo(
    () =>
      runDecisionPipeline({
        timeframe,
        session: currentSession(),
        analysis,
        confluence,
        mtf: structure?.mtf ?? null,
        entryStructure: structure?.entryStructure ?? null,
        macro,
        quant,
        sessionReport,
        management,
        quote: market.quote ?? null,
        connection: market.status as any,
        settings: settingsRow,
        snapshot: snapshot.data ?? null,
        trades: tradeRows as any[],
        killSwitch,
        running,
        execConnected: executor.connected,
        tradingMode,
        challenge: { enforced: challengeEnforced, status: challengeStatus, profile: challengeProfile },
        calibration: (forensicsQuery.data as any)?.calibration ?? null,
        environmentTrackRecord,
        cycleId: cycleRef.current?.id ?? "cycle",
      }),
    [timeframe, analysis, confluence, macro, quant, structure, sessionReport, management, market.quote, market.status,
     settingsRow, snapshot.data, tradeRows, killSwitch, running, executor.connected, tradingMode,
     challengeEnforced, challengeStatus, challengeProfile, forensicsQuery.data, environmentTrackRecord],
  );

  const { account, adaptive, composite, safety, riskScore } = decision;
  const openTrades = account.openTrades;
  const consecutiveLosses = account.consecutiveLosses;
  const todayTradeCount = account.todayTradeCount;
  const lastRejection = analysis?.setup ? decision.rejection : null;

  // --- Excursion tracking ------------------------------------------------
  const recordExcursionsFn = useServerFn(recordExcursions);
  const excursionRef = useRef<Map<string, { mae: number; mfe: number }>>(new Map());
  const excursionFlushRef = useRef(0);

  useEffect(() => {
    const price = market.quote?.mid;
    if (!price || openTrades.length === 0) return;

    const rows: Array<{ id: string; mae: number; mfe: number; mae_r: number; mfe_r: number }> = [];
    for (const t of openTrades) {
      const prev = excursionRef.current.get(t.id) ?? { mae: 0, mfe: 0 };
      const seen = { direction: t.direction, entry_price: t.entry_price, stop_loss: t.stop_loss, ...prev };
      const next = updateExcursion(seen, price);
      if (!next) continue;
      const moved = excursionChanged(seen, next);
      excursionRef.current.set(t.id, { mae: next.mae, mfe: next.mfe });
      if (moved) rows.push({ id: t.id, mae: next.mae, mfe: next.mfe, mae_r: next.mae_r, mfe_r: next.mfe_r });
    }

    if (rows.length === 0 || Date.now() - excursionFlushRef.current < 20_000) return;
    excursionFlushRef.current = Date.now();
    recordExcursionsFn({ data: { rows: rows.slice(0, 50) } }).catch(() => {});
  }, [market.quote?.mid, openTrades, recordExcursionsFn]);

  // --- Server-side heartbeat: durable proof the engine is alive ---
  const heartbeatFn = useServerFn(recordHeartbeat);
  useEffect(() => {
    const beat = () => {
      heartbeatFn({
        data: {
          engine: "autopilot",
          status: killSwitch.active ? "degraded" : running ? "ok" : "down",
          detail: {
            running,
            mode: tradingMode,
            open_trades: openTrades.length,
            market: market.status,
            preservation_tier: adaptive.tier,
            confidence_gate: adaptive.confidenceThreshold,
          },
        },
      }).catch(() => {});
    };
    beat();
    const t = window.setInterval(beat, 60_000);
    return () => window.clearInterval(t);
  }, [heartbeatFn, running, killSwitch.active, tradingMode, openTrades.length, market.status, adaptive.tier, adaptive.confidenceThreshold]);

  // --- Automatic kill-switch trips, decided by the shared pipeline -------
  useEffect(() => {
    if (!decision.killSwitchTrip) return;
    triggerKillSwitch(decision.killSwitchTrip);
  }, [decision.killSwitchTrip, triggerKillSwitch]);

  // --- Analysis loop -----------------------------------------------------
  const runAnalysisNow = useCallback(async () => {
    if (analysing) return;
    if (!market.quote?.mid) return;
    setAnalysing(true);
    const cycleId = crypto.randomUUID();
    cycleRef.current = { id: cycleId, startedAt: Date.now() };
    bus.emit("ai:started", { cycleId, timeframe });
    const endAi = metrics.start("ai");
    try {
      const res: any = await analyzeFn({ data: { timeframe, session: currentSession(), price: market.quote.mid } });
      const aiMs = endAi();
      setAnalysis(res);
      const endConf = metrics.start("confluence");
      const conf = computeConfluence({
        analysis: res,
        htfBias: res?.bias ?? null,
        spread: market.quote?.spread ?? null,
      });
      endConf();
      setConfluence(conf);
      lastAnalysedPriceRef.current = market.quote.mid;
      lastAnalyseRef.current = Date.now();
      bus.emit("ai:completed", {
        cycleId,
        durationMs: Math.round(aiMs),
        bias: res?.bias ?? null,
        confidence: conf.score,
      });
      log("info", `Analysis refreshed — ${res?.bias ?? "?"} · ${conf.score}% confluence · ${Math.round(aiMs)}ms`);
    } catch (e: any) {
      endAi();
      bus.emit("ai:failed", { cycleId, error: e?.message ?? "analysis failed" });
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

  // --- Audit trail: every evaluated cycle is published exactly once ------
  useEffect(() => {
    const cycle = cycleRef.current;
    if (!cycle || !composite || !analysis) return;
    if (loggedCycleRef.current === cycle.id) return;
    loggedCycleRef.current = cycle.id;

    const setup = analysis?.setup ?? null;
    const blockers = [...(composite.blockers ?? []), ...(safety.failingReasons ?? [])];
    const latencySnapshot = metrics.getSnapshot().latency;

    const snapshotEvent: DecisionSnapshot = {
      cycleId: cycle.id,
      ts: Date.now(),
      symbol: "XAUUSD",
      timeframe,
      outcome: blockers.length === 0 && running ? "accepted" : "rejected",
      direction: (setup?.direction as "BUY" | "SELL" | undefined) ?? null,
      confidence: composite.final,
      technicalScore: composite.technical,
      newsScore: composite.news,
      reasoning: [
        analysis?.explanation,
        ...(confluence?.supporting ?? []),
        ...composite.contributions.map((c) => `${c.label}: ${c.score}/100 (weight ${Math.round(c.weight * 100)}%)`),
        ...environment.notes,
      ].filter(Boolean).slice(0, 40) as string[],
      blockers: blockers.slice(0, 40),
      price: market.quote?.mid ?? null,
      spread: market.quote?.spread ?? null,
      latency: {
        ai: latencySnapshot.ai.last ?? 0,
        market: latencySnapshot.market.last ?? 0,
        confluence: latencySnapshot.confluence.last ?? 0,
        execution: latencySnapshot.execution.last ?? 0,
      },
      environment: envKey,
      environmentConfidence: environment.regime_confidence,
      payload: {
        bias: analysis?.bias ?? null,
        risk_reward: setup?.risk_reward ?? null,
        entry: setup?.entry ?? null,
        stop_loss: setup?.stop_loss ?? null,
        mode: tradingMode,
        running,
        preservation_tier: adaptive.tier,
      },
    };
    bus.emit("decision:evaluated", snapshotEvent);
  }, [safety, composite, analysis, confluence, timeframe, market.quote, running, tradingMode, environment, envKey, adaptive.tier]);

  // --- Submit the legs the pipeline decided on --------------------------
  useEffect(() => {
    if (decision.action !== "open" || decision.plans.length === 0) return;
    if (inFlightRef.current) return;
    // A structurally unusable candle feed is not a trading condition.
    if (feedBroken) return;


    const sigKey = decision.setupKey;
    if (!sigKey || managedRef.current.has(sigKey)) return;

    const toOpen = decision.plans;
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
      const cycleId = cycleRef.current?.id ?? "manual";
      for (const [i, plan] of toOpen.entries()) {
        const endExec = metrics.start("execution");
        try {
          await executor.submit({ ...plan, environment: plan.environment ?? envKey });
          const ms = endExec();
          bus.emit("execution:submitted", {
            cycleId, direction: plan.direction, entry: plan.entry,
            lots: plan.lot_size, leg: i + 1, legs: toOpen.length,
          });
          log("success",
            `Opened ${plan.direction} leg ${i + 1}/${toOpen.length} @ ${plan.entry.toFixed(2)} · ${plan.lot_size} lots → TP ${plan.take_profit_1.toFixed(2)}`,
            `Risk ${decision.riskPctPerLeg}% · Confidence ${plan.confidence}% · R:R ${plan.risk_reward.toFixed(2)} · ${Math.round(ms)}ms`);
        } catch (e: any) {
          endExec();
          bus.emit("execution:failed", { cycleId, error: e?.message ?? "execution failed" });
          log("error", `Leg ${i + 1} rejected by execution engine`, e?.message);
        }
      }

      toast.success(`Autopilot opened ${toOpen.length} trade${toOpen.length > 1 ? "s" : ""}`);
      qc.invalidateQueries({ queryKey: ["trades"] });
      qc.invalidateQueries({ queryKey: ["snapshot"] });
      inFlightRef.current = false;
    })();
  }, [decision, composite, analysis, confluence, macro, executor, envKey, feedBroken, log, qc]);

  // --- Autonomous position management on every price tick ---------------
  useEffect(() => {
    const actions = planPositionActions({
      openTrades,
      price: market.quote?.mid,
      atr: quant?.volatility?.atr ?? null,
      management,
    });
    for (const { trade: t, action, dedupeKey } of actions) {
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
  }, [market.quote?.mid, openTrades, executor, log, qc, quant?.volatility?.atr, management]);

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
    quant, quantLoading: quantQuery.isLoading, sessionReport, management,
    lastRejection, lastPlan, analysing, market, snapshot: snapshot.data,
    settings: settings.data, openTrades, executor,
    consecutiveLosses, todayTradeCount,
    environment, environmentKey: envKey, environmentTrackRecord, decision,
    adaptive, forensics: forensicsQuery.data ?? null,
    start, stop, runAnalysisNow, triggerKillSwitch, resetKillSwitch,
    constants: SAFETY_CONSTANTS,
  };
}
