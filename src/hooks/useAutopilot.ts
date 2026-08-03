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
import { getChallengeStatus } from "@/lib/challenge.functions";
import type { ChallengeStatus } from "@/lib/challenge/engine";

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
import { buildLadderPlans, createPaperExecutionEngine, createLiveExecutionEngine, MAX_RISK_PER_LEG_PCT } from "@/lib/services/execution";
import { buildAdaptivePolicy, type AdaptivePolicy } from "@/lib/services/adaptive";
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

  // --- Quantitative intelligence: volume, volatility, momentum, candles, correlation ---
  // Scored directionally against the current setup and cached server-side, so
  // the extra analysis costs one small request per cycle.
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
  const sessionReport = useMemo(
    () => analyseSessions(Array.isArray(trades.data) ? (trades.data as any[]) : [], currentSession()),
    [trades.data],
  );

  const management = useMemo(
    () => buildManagementPlan({ volatility: quant?.volatility, momentum: quant?.momentum }),
    [quant?.volatility, quant?.momentum],
  );

  // Execution destination: paper engine, or the user's connected broker.
  // The AI, risk and management logic is identical either way.
  const openFn = useServerFn(openPaperTrade);
  const closeFn = useServerFn(closePaperTrade);
  const patchStopFn = useServerFn(updateTradeStop);
  const placeLiveFn = useServerFn(placeLiveOrder);
  const closeLiveFn = useServerFn(closeLiveOrder);
  const modifyLiveFn = useServerFn(modifyLiveOrder);
  const brokersFn = useServerFn(listBrokerConnections);

  const brokersQuery = useQuery({
    queryKey: ["broker-connections"],
    queryFn: () => brokersFn(),
    refetchInterval: 30_000,
  });
  const defaultBroker = useMemo(() => {
    const rows: any[] = Array.isArray(brokersQuery.data) ? brokersQuery.data : [];
    return rows.find((r) => r.is_default) ?? null;
  }, [brokersQuery.data]);

  const tradingMode: "paper" | "live" =
    (settings.data as any)?.trading_mode === "live" ? "live" : "paper";
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

  // --- Forensics + calibration: how the engine has actually performed ---
  const forensicsFn = useServerFn(getForensics);
  const forensicsQuery = useQuery({
    queryKey: ["forensics"],
    queryFn: () => forensicsFn(),
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  // Peak-to-trough drawdown over the realised equity curve.
  const drawdownPct = useMemo(() => {
    const closed = tradeRows.filter((t: any) => t.status === "closed" && t.pnl != null)
      .sort((a: any, b: any) => new Date(a.closed_at).getTime() - new Date(b.closed_at).getTime());
    const start = Number(snapshot.data?.account?.balance ?? 10000)
      - closed.reduce((a: number, t: any) => a + Number(t.pnl), 0);
    let eq = start, peak = start, worst = 0;
    for (const t of closed) {
      eq += Number(t.pnl);
      peak = Math.max(peak, eq);
      worst = Math.max(worst, peak > 0 ? ((peak - eq) / peak) * 100 : 0);
    }
    return Number(worst.toFixed(2));
  }, [tradeRows, snapshot.data]);

  // --- Adaptive capital preservation ---
  // Static thresholds treat a healthy account and a wounded one the same.
  // This layer tightens both size and the confidence bar as the account
  // comes under pressure, and relaxes back to full allowance once the
  // engine is calibrated and the drawdown has healed.
  const adaptive: AdaptivePolicy = useMemo(() => {
    const s: any = settings.data ?? {};
    const bal = Number(snapshot.data?.account?.balance ?? 1) || 1;
    return buildAdaptivePolicy({
      drawdownPct,
      maxDrawdownPct: Number(s.max_drawdown_pct ?? 10) || 10,
      dailyLossPct: -Math.min(0, Number(snapshot.data?.daily_pnl ?? 0)) / bal * 100,
      maxDailyLossPct: Number(s.max_daily_loss ?? 3) || 3,
      consecutiveLosses,
      recentPnl: tradeRows
        .filter((t: any) => t.status === "closed" && t.pnl != null)
        .sort((a: any, b: any) => new Date(b.closed_at).getTime() - new Date(a.closed_at).getTime())
        .slice(0, 10)
        .map((t: any) => Number(t.pnl)),
      calibration: forensicsQuery.data?.calibration ?? null,
      baseThreshold: SAFETY_CONSTANTS.MIN_CONFIDENCE,
    });
  }, [drawdownPct, settings.data, snapshot.data, consecutiveLosses, tradeRows, forensicsQuery.data]);

  // --- Excursion tracking: how far every open trade went against us and
  // in our favour. Recorded on a throttle so the audit trail survives even
  // if the tab closes mid-trade. ---
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

    // Persist at most once every 20s — the numbers only ratchet upward, so
    // a throttled write loses nothing.
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

  // --- Composite confidence: technical + news + sentiment + risk +
  // volume + volatility + momentum + session + correlation ---
  useEffect(() => {
    setComposite(computeComposite({
      confluence, analysis, macro, riskScore,
      finalThreshold: adaptive.confidenceThreshold,
      volume: quant?.volume, volatility: quant?.volatility, momentum: quant?.momentum,
      candleQuality: quant?.candles, correlation: quant?.correlation,
      session: sessionReport,
    }));
  }, [confluence, analysis, macro, riskScore, quant, sessionReport, adaptive.confidenceThreshold]);

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
      challenge: { enforced: challengeEnforced, status: challengeStatus },
    });
    setSafety(report);
  }, [analysis, confluence, market.quote, market.status, settings.data, snapshot.data,
      openTrades, todayTradeCount, consecutiveLosses, killSwitch, executor.connected, macro, composite,
      challengeEnforced, challengeStatus]);


  // --- Audit trail: every evaluated cycle is published exactly once,
  // whether the trade was taken or rejected. The logging engine batches
  // these to the database off the hot path.
  useEffect(() => {
    const cycle = cycleRef.current;
    if (!cycle || !safety || !composite || !analysis) return;
    if (loggedCycleRef.current === cycle.id) return;
    loggedCycleRef.current = cycle.id;

    const setup = analysis?.setup ?? null;
    const blockers = [...(composite.blockers ?? []), ...(safety.failingReasons ?? [])];
    const latencySnapshot = metrics.getSnapshot().latency;

    const decision: DecisionSnapshot = {
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
      payload: {
        bias: analysis?.bias ?? null,
        risk_reward: setup?.risk_reward ?? null,
        entry: setup?.entry ?? null,
        stop_loss: setup?.stop_loss ?? null,
        mode: tradingMode,
        running,
      },
    };
    bus.emit("decision:evaluated", decision);
  }, [safety, composite, analysis, confluence, timeframe, market.quote, running, tradingMode]);


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
    const mult = composite
      ? sizeMultiplier(macro, composite, { volume: quant?.volume, volatility: quant?.volatility })
      : 1;
    const targets = [setup.take_profit_1, setup.take_profit_2, setup.take_profit_3]
      .filter((t: any) => t != null)
      .map((t: any) => Number(t));

    // Capital preservation is the innermost multiplier: the deeper the
    // account is into its drawdown allowance — or the more over-optimistic
    // the confidence engine has proven to be — the smaller every leg gets.
    let riskPctPerLeg = Number((Math.min(
      MAX_RISK_PER_LEG_PCT,
      Number(settings.data?.risk_per_trade ?? MAX_RISK_PER_LEG_PCT),
    ) * mult * adaptive.sizeMultiplier).toFixed(3));

    if (adaptive.halted) {
      log("warn", "Capital preservation lockdown", adaptive.reasons[0]);
      return;
    }

    // Challenge compliance is the outer envelope: the whole ladder must fit
    // inside the account's remaining margin for error, after its safety
    // buffer. Whichever limit is stricter — strategy risk or challenge
    // budget — is the one that applies.
    if (challengeEnforced && challengeStatus) {
      const legs = Math.max(1, targets.length);
      const challengeCapPerLeg = challengeStatus.maxRiskPctForNextTrade / legs;
      riskPctPerLeg = Number(Math.min(riskPctPerLeg * challengeStatus.sizeMultiplier, challengeCapPerLeg).toFixed(3));
      if (riskPctPerLeg <= 0) {
        log("warn", "Challenge budget exhausted", "No risk budget remains inside the account's safety buffer");
        return;
      }
    }

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
      ai_analysis: {
        ...analysis, macro, composite, quant, session_stats: sessionReport, management,
        challenge: challengeEnforced && challengeStatus
          ? {
              profile_id: challengeProfile?.id ?? null,
              provider: challengeProfile?.provider ?? null,
              phase: challengeProfile?.phase ?? null,
              posture: challengeStatus.posture,
              pass_probability: challengeStatus.passProbability,
              health: challengeStatus.health,
              daily_used_pct: challengeStatus.daily.usedPct,
              drawdown_used_pct: challengeStatus.drawdown.usedPct,
            }
          : null,
      },
    };

    const plans = buildLadderPlans({
      base,
      targets,
      balance,
      riskPctPerLeg,
      cycleId: cycleRef.current?.id ?? sigKey,
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
      const cycleId = cycleRef.current?.id ?? "manual";
      for (const [i, plan] of toOpen.entries()) {
        const endExec = metrics.start("execution");
        try {
          await executor.submit(plan);
          const ms = endExec();
          bus.emit("execution:submitted", {
            cycleId, direction: plan.direction, entry: plan.entry,
            lots: plan.lot_size, leg: i + 1, legs: toOpen.length,
          });
          log("success",
            `Opened ${plan.direction} leg ${i + 1}/${toOpen.length} @ ${plan.entry.toFixed(2)} · ${plan.lot_size} lots → TP ${plan.take_profit_1.toFixed(2)}`,
            `Risk ${riskPctPerLeg}% · Confidence ${plan.confidence}% · R:R ${plan.risk_reward.toFixed(2)} · ${Math.round(ms)}ms`);
        } catch (e: any) {
          endExec();
          bus.emit("execution:failed", { cycleId, error: e?.message ?? "execution failed" });
          log("error", `Leg ${i + 1} rejected by execution engine`, e?.message);
        }
      }

      toast.success(`Autopilot opened ${toOpen.length} paper trade${toOpen.length > 1 ? "s" : ""}`);
      qc.invalidateQueries({ queryKey: ["trades"] });
      qc.invalidateQueries({ queryKey: ["snapshot"] });
      inFlightRef.current = false;
    })();
  }, [running, killSwitch.active, safety, analysis, market.quote, snapshot.data,
      settings.data, confluence, timeframe, executor, log, qc, openTrades, composite, macro,
      quant, sessionReport, management, challengeEnforced, challengeStatus, challengeProfile,
      adaptive]);


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
      const action = evaluatePosition({
        trade: t, price,
        atr: quant?.volatility?.atr ?? null,
        plan: management,
      });
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
    adaptive, forensics: forensicsQuery.data ?? null,
    start, stop, runAnalysisNow, triggerKillSwitch, resetKillSwitch,
    constants: SAFETY_CONSTANTS,
  };
}
