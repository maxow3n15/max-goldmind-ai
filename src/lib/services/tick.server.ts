// Server-side execution of the autopilot cycle.
//
// One pass per enabled user, using the shared decision pipeline in
// services/orchestrator.ts — the same computations the browser engine runs.
// Nothing here re-implements trading logic; it only supplies inputs, applies
// the pipeline's decision, and persists the outcome.

import { analyseSessions } from "./session-stats";
import { buildCalibration } from "./calibration";
import { buildManagementPlan } from "./trade-management";
import { classifyEnvironment, environmentKey } from "./environment";
import { planPositionActions, runDecisionPipeline } from "./orchestrator";
import { fetchSpotQuote } from "./spot.server";
import { marketStateHash, StateCache } from "./market-state";
import type { MarketStructureBundle } from "@/lib/mtf.server";
import type { MacroReport } from "./macro.types";
import type { QuantIntel } from "./quant.types";

const MAX_USERS_PER_TICK = 50;

/**
 * AI analyses keyed by market-state hash. The market usually has not changed
 * meaningfully between one-minute ticks; re-running the model on an identical
 * state buys nothing and costs latency and quota.
 */
const analysisByState = new StateCache<any>(10 * 60_000, 32);

function sessionNow(): string {
  const h = new Date().getUTCHours();
  if (h < 7) return "Asian";
  if (h < 12) return "London";
  if (h < 17) return "London/NY Overlap";
  if (h < 21) return "New York";
  return "After hours";
}


export const TICK_LOCK_KEY = "scheduled_tick";
/** Slightly longer than the cron interval, so a slow run is not double-fired. */
export const TICK_LOCK_TTL_SECONDS = 120;

/**
 * Entry point for the cron route. Takes a cluster-wide lock first: overlapping
 * invocations return `{ skipped: "locked" }` instead of acting on the same
 * users twice in one window.
 */
export async function runScheduledTick() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { acquireLock } = await import("@/lib/services/lock.server");

  const lock = await acquireLock(supabaseAdmin, TICK_LOCK_KEY, TICK_LOCK_TTL_SECONDS);
  if (!lock) {
    return { users: 0, opened: 0, managed: 0, skipped: "locked" as const };
  }
  try {
    return await runTickCycle(supabaseAdmin);
  } finally {
    await lock.release();
  }
}

async function runTickCycle(supabaseAdmin: any) {

  const { data: users } = await supabaseAdmin
    .from("user_settings")
    .select("*")
    .eq("auto_execute", true)
    .eq("kill_switch_active", false)
    .limit(MAX_USERS_PER_TICK);

  const enabled = users ?? [];
  if (enabled.length === 0) return { users: 0, opened: 0, managed: 0 };

  const quote = await fetchSpotQuote();

  // Macro and quant are market-wide: computed once, shared by every user.
  const { buildMacroReport } = await import("@/lib/macro.functions");
  const { buildQuantIntel } = await import("@/lib/quant.server");

  let macro: MacroReport | null = null;
  try { macro = await buildMacroReport(); } catch { macro = null; }

  const quantCache = new Map<string, QuantIntel | null>();
  const analysisCache = new Map<string, any>();
  const structureCache = new Map<string, MarketStructureBundle | null>();
  const session = sessionNow();

  let opened = 0;
  let managed = 0;
  let reconciled = 0;
  const errors: string[] = [];

  for (const settings of enabled) {
    const userId = settings.user_id as string;
    const timeframe = String(settings.preferred_timeframe ?? "15");
    const cycleId = `srv-${userId.slice(0, 8)}-${Math.floor(Date.now() / 60_000)}`;

    try {
      // ---- Inputs -------------------------------------------------------
      let quant = quantCache.get(timeframe);
      if (quant === undefined) {
        try { quant = await buildQuantIntel(timeframe, null); }
        catch { quant = null; }
        quantCache.set(timeframe, quant);
      }

      // Structure is what the safety engine's timeframe-agreement gate reads.
      // Without it every automated decision fails that gate by construction.
      let structure = structureCache.get(timeframe);
      if (structure === undefined) {
        const { buildMarketStructure } = await import("@/lib/mtf.server");
        try { structure = await buildMarketStructure(timeframe); }
        catch { structure = null; }
        structureCache.set(timeframe, structure);
      }

      // A structurally unusable candle feed is not a trading condition.
      const feedBroken = structure?.integrity.status === "INVALID";

      let analysis = analysisCache.get(timeframe);
      if (analysis === undefined) {
        // No live quote means no trustworthy reference price: skip the AI call
        // entirely rather than analysing gold against nothing.
        if (!quote?.mid || feedBroken) {
          analysis = null;
        } else {
          const stateKey = marketStateHash({
            timeframe,
            lastCandleAt: structure?.lastCandleAt ?? null,
            price: quote.mid,
            mtf: structure?.mtf ?? null,
            macro,
            session,
          });
          const cached = analysisByState.get(stateKey);
          if (cached !== undefined) {
            analysis = cached;
          } else {
            const { runMarketAnalysis } = await import("@/lib/ai-analysis.server");
            const { buildEvidence } = await import("@/lib/ai-context.server");
            try {
              // The model only ever sees platform-computed facts.
              const evidence = await buildEvidence({
                timeframe,
                price: quote.mid,
                quant: quant ?? null,
                macro,
                structure: structure ?? null,
              }).catch(() => null);
              analysis = await runMarketAnalysis({
                timeframe, price: quote.mid, session, userId, source: "tick", evidence,
              });

              if (analysis) analysisByState.set(stateKey, analysis);
            } catch {
              analysis = null;
            }
          }
        }
        analysisCache.set(timeframe, analysis);
      }


      const [{ data: tradeRows }, { data: acct }] = await Promise.all([
        supabaseAdmin.from("trades").select("*").eq("user_id", userId)
          .order("opened_at", { ascending: false }).limit(200),
        supabaseAdmin.from("paper_account").select("*").eq("user_id", userId).maybeSingle(),
      ]);
      const trades = tradeRows ?? [];

      const closed = trades.filter((t: any) => t.status === "closed" && t.pnl != null);
      const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
      const weekStart = new Date(Date.now() - 7 * 86400_000);
      const sumSince = (d: Date) =>
        closed.filter((t: any) => t.closed_at && new Date(t.closed_at) >= d)
          .reduce((a: number, t: any) => a + Number(t.pnl), 0);
      const tradingMode: "paper" | "live" = settings.trading_mode === "live" ? "live" : "paper";
      // Paper mode uses the internal paper account. Broker mode NEVER does —
      // it is replaced below by the broker's own account state.
      const snapshot: { account: any; daily_pnl: number; weekly_pnl: number } = {
        account: acct ?? { balance: 10000, equity: 10000, free_margin: 10000, margin_used: 0 },
        daily_pnl: sumSince(dayStart),
        weekly_pnl: sumSince(weekStart),
      };


      const calibration = buildCalibration(
        closed.map((t: any) => ({ confidence: t.confidence, pnl: t.pnl })),
      );

      const { computeChallengeStatus } = await import("@/lib/challenge/status.server");
      let challenge: { enforced: boolean; status: any; profile: any } = {
        enforced: false, status: null, profile: null,
      };
      try {
        const cs = await computeChallengeStatus(supabaseAdmin, userId, null);
        challenge = {
          enforced: !!cs.profile?.auto_enforce,
          status: cs.status,
          profile: cs.profile,
        };
      } catch { /* challenge is optional */ }

      const sessionReport = analyseSessions(
        closed.map((t: any) => ({
          pnl: Number(t.pnl), opened_at: t.opened_at, closed_at: t.closed_at,
          risk_reward: t.risk_reward == null ? null : Number(t.risk_reward),
        })) as any,
        session,
      );

      const management = quant
        ? buildManagementPlan({ volatility: quant.volatility, momentum: quant.momentum })
        : null;

      // Reconcile before deciding: any trade whose broker state disagrees with
      // ours is moved out of "open", so the decision pipeline below never sizes
      // or manages against a position we cannot account for.
      let reconciliationBlocked: string | null = null;
      let brokerEnvironment: string | null = null;
      if (tradingMode === "live") {
        try {
          const { reconcileUserPositions } = await import("@/lib/services/reconciliation.server");
          const rec = await reconcileUserPositions(supabaseAdmin, userId);
          if (rec.mismatches.length > 0) {
            reconciled += rec.mismatches.length;
            reconciliationBlocked = `${rec.mismatches.length} unresolved broker/database mismatch(es)`;
            errors.push(
              `reconciliation: ${rec.mismatches.length} mismatch(es) for ${userId} — ${rec.mismatches
                .map((m) => `${m.trade_id}:${m.kind}`)
                .join(", ")}`,
            );
          }
        } catch (e: any) {
          reconciliationBlocked = "reconciliation failed";
          console.error(`[tick] reconciliation failed for ${userId}:`, e?.message ?? e);
        }
      }

      // Live mode is only actually executable when the user has a healthy
      // default broker whose credentials still decrypt.
      const { isLiveBrokerConnected, loadDefaultBrokerConnection, resolveConnectionEnvironment } =
        await import("@/lib/brokers/live-execution.server");
      let execConnected = tradingMode === "paper" ? true : await isLiveBrokerConnected(supabaseAdmin, userId);

      // Broker mode is sized from the BROKER account, never the paper account.
      if (tradingMode === "live" && execConnected) {
        try {
          const conn = await loadDefaultBrokerConnection(supabaseAdmin, userId);
          const resolved = await resolveConnectionEnvironment(conn);
          brokerEnvironment = resolved.env;
          const { getConnector } = await import("@/lib/brokers/connectors.server");
          const brokerAccount = await getConnector(conn.broker_id).fetchAccount(resolved.credentials);
          snapshot.account = {
            balance: brokerAccount.balance,
            equity: brokerAccount.equity,
            free_margin: brokerAccount.free_margin,
            margin_used: Math.max(0, brokerAccount.equity - brokerAccount.free_margin),
            currency: brokerAccount.currency,
            source: `broker:${conn.broker_id}`,
          };
          await supabaseAdmin
            .from("broker_connections")
            .update({
              ...brokerAccount,
              status: "connected",
              last_error: null,
              last_sync_at: new Date().toISOString(),
            })
            .eq("id", conn.id);
        } catch (e: any) {
          // No verified broker account state = no autonomous broker trading.
          execConnected = false;
          errors.push(`broker account refresh failed for ${userId.slice(0, 8)}: ${String(e?.message ?? e).slice(0, 140)}`);
        }
      }




      // Classify first so the environment's own track record can inform the
      // adaptive policy in the very same cycle.
      const preEnvKey = environmentKey(classifyEnvironment(quant ?? null, macro));

      // ---- Decide -------------------------------------------------------
      const decision = runDecisionPipeline({
        timeframe,
        session,
        analysis,
        confluence: null,
        mtf: structure?.mtf ?? null,
        entryStructure: structure?.entryStructure ?? null,
        macro,
        quant: quant ?? null,
        sessionReport,
        management,
        quote,
        connection: quote ? "connected" : "disconnected",
        settings,
        snapshot,
        trades,
        killSwitch: { active: false, reason: null, since: null } as any,
        running: true,
        execConnected,
        tradingMode,
        challenge,
        calibration,
        environmentTrackRecord: environmentTrackRecordFor(trades, preEnvKey),
        cycleId,
      });

      const envKey = decision.environmentKey;

      // ---- Manage open positions ---------------------------------------
      const actions = planPositionActions({
        openTrades: decision.account.openTrades,
        price: quote?.mid ?? null,
        atr: quant?.volatility.atr ?? null,
        management,
      });
      for (const a of actions) {
        // An unconfirmed broker close/modify throws and flags the trade for
        // reconciliation; that must not abort management of the other trades.
        try {
          if (a.action.type === "close") {
            await closeTrade(
              supabaseAdmin, userId, a.trade.id,
              quote?.mid ?? a.trade.entry_price, a.action.reason, tradingMode,
            );
            managed += 1;
          } else if (a.action.type === "move_stop") {
            if (tradingMode === "live") {
              const { modifyLiveOrderCore } = await import("@/lib/brokers/live-execution.server");
              await modifyLiveOrderCore(supabaseAdmin, userId, {
                id: a.trade.id, stop_loss: a.action.new_stop,
              });
            } else {
              await supabaseAdmin.from("trades")
                .update({ stop_loss: a.action.new_stop })
                .eq("id", a.trade.id).eq("user_id", userId);
            }
            managed += 1;
          }
        } catch (e: any) {
          console.error(
            `[tick] trade management failed — user=${userId} trade=${a.trade.id} action=${a.action.type}:`,
            e?.message ?? e,
          );
        }
      }


      // ---- Kill switch ---------------------------------------------------
      if (decision.killSwitchTrip) {
        await supabaseAdmin.from("user_settings").update({
          kill_switch_active: true,
          kill_switch_reason: decision.killSwitchTrip,
          kill_switch_since: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("user_id", userId);
      }

      // ---- Open new legs --------------------------------------------------
      const openBlocked =
        decision.killSwitchTrip ? "kill switch tripped"
        : feedBroken ? "candle feed unusable"
        : reconciliationBlocked ? `reconciliation required — ${reconciliationBlocked}`
        : null;
      let submitted = 0;
      const submissionErrors: string[] = [];
      if (decision.action === "open" && !openBlocked) {
        for (const plan of decision.plans) {
          submitted += 1;
          try {
            const inserted = await openTrade(supabaseAdmin, userId, plan, tradingMode, envKey, quote?.spread ?? undefined);
            if (inserted) opened += 1;
            else submissionErrors.push(`${plan.client_order_id ?? "plan"}: not filled`);
          } catch (e: any) {
            submissionErrors.push(`${plan.client_order_id ?? "plan"}: ${String(e?.message ?? e).slice(0, 140)}`);
          }
        }
      }

      // ---- Audit trail -----------------------------------------------------
      await supabaseAdmin.from("decision_logs").upsert({
        user_id: userId,
        cycle_id: cycleId,
        decided_at: new Date().toISOString(),
        symbol: "XAUUSD",
        timeframe,
        outcome: decision.action === "open" && !openBlocked ? "accepted" : "rejected",
        direction: analysis?.setup?.direction ?? null,
        confidence: decision.composite?.final ?? analysis?.confidence ?? null,
        technical_score: decision.composite?.technical ?? null,
        news_score: decision.composite?.news ?? null,
        reasoning: decision.adaptive.reasons.slice(0, 20),
        blockers: [
          ...decision.safety.failingReasons,
          ...(feedBroken ? [`Candle feed unusable: ${structure?.integrity.issues[0] ?? "insufficient data"}`] : []),
          ...(openBlocked ? [openBlocked] : []),
        ].slice(0, 20),
        price: quote?.mid ?? null,
        spread: quote?.spread ?? null,
        latency: {},
        payload: {
          source: "cron",
          tier: decision.adaptive.tier,
          trading_mode: tradingMode,
          broker_environment: brokerEnvironment,
          account_source: snapshot.account?.source ?? "paper_account",
          account_equity: snapshot.account?.equity ?? null,
          daily_pnl: snapshot.daily_pnl,
          news_status: macro ? "ok" : "unavailable",
          news_score: decision.composite?.news ?? null,
          confidence_components: decision.composite ?? null,
          timeframe_alignment: structure?.mtf?.alignment ?? null,
          risk_rejections: decision.safety.failingReasons.slice(0, 6),
          orders_submitted: submitted,
          orders_filled: opened,
          submission_errors: submissionErrors.slice(0, 5),
          feed_integrity: structure?.integrity.status ?? "UNKNOWN",
          feed_issues: structure?.integrity.issues.slice(0, 4) ?? [],
        },
        environment: envKey,
        environment_confidence: decision.environment.regime_confidence,
      }, { onConflict: "user_id,cycle_id", ignoreDuplicates: true });

    } catch (e: any) {
      errors.push(`${userId.slice(0, 8)}: ${String(e?.message ?? e).slice(0, 160)}`);
    }
  }

  return { users: enabled.length, opened, managed, reconciled, errors };
}

/* -------------------------------------------------------------- */

/**
 * The user's realised record in a given environment. Returns null below the
 * minimum sample so the adaptive policy stays unchanged rather than reacting
 * to noise.
 */
function environmentTrackRecordFor(trades: any[], key: string | null) {
  if (!key) return null;
  const rows = trades.filter(
    (t) => t.status === "closed" && t.pnl != null && t.environment === key,
  );
  if (rows.length === 0) return null;
  const wins = rows.filter((t) => Number(t.pnl) > 0).length;
  return { winRate: (wins / rows.length) * 100, trades: rows.length };
}

async function openTrade(
  supabase: any,
  userId: string,
  plan: any,
  mode: "paper" | "live",
  environment: string | null,
  spread?: number,
) {
  if (plan.client_order_id) {
    const { data: existing } = await supabase.from("trades").select("id")
      .eq("user_id", userId).eq("client_order_id", plan.client_order_id).maybeSingle();
    if (existing) return false;
  }

  // Live mode goes through the very same broker execution core the browser
  // autopilot uses — a real order is placed before any row is written.
  if (mode === "live") {
    const { placeLiveOrderCore } = await import("@/lib/brokers/live-execution.server");
    const res = await placeLiveOrderCore(supabase, userId, {
      direction: plan.direction,
      entry_price: plan.entry,
      stop_loss: plan.stop_loss,
      take_profit_1: plan.take_profit_1 ?? null,
      take_profit_2: plan.take_profit_2 ?? null,
      take_profit_3: plan.take_profit_3 ?? null,
      lot_size: plan.lot_size,
      spread,
      confidence: plan.confidence ?? undefined,
      timeframe: plan.timeframe ?? undefined,
      session: plan.session ?? undefined,
      reason_entry: plan.reason ?? undefined,
      ai_analysis: plan.ai_analysis ?? undefined,
      source: "auto",
      environment,
      client_order_id: plan.client_order_id ?? null,
    });
    return res.ok;
  }

  const { error } = await supabase.from("trades").insert({
    user_id: userId,
    symbol: "XAUUSD",
    direction: plan.direction,
    entry_price: plan.entry,
    stop_loss: plan.stop_loss,
    take_profit_1: plan.take_profit_1 ?? null,
    take_profit_2: plan.take_profit_2 ?? null,
    take_profit_3: plan.take_profit_3 ?? null,
    lot_size: plan.lot_size,
    risk_reward: plan.risk_reward ?? null,
    confidence: plan.confidence ?? null,
    timeframe: plan.timeframe ?? null,
    session: plan.session ?? null,
    reason_entry: plan.reason ?? null,
    ai_analysis: plan.ai_analysis ?? null,
    client_order_id: plan.client_order_id ?? null,
    source: "auto",
    environment,
    mode,
    status: "open",
  });
  return !error;
}

async function closeTrade(
  supabase: any,
  userId: string,
  id: string,
  exitPrice: number,
  reason: string,
  mode: "paper" | "live" = "paper",
) {
  if (mode === "live") {
    const { closeLiveOrderCore } = await import("@/lib/brokers/live-execution.server");
    await closeLiveOrderCore(supabase, userId, {
      id, exit_price: exitPrice, reason_exit: reason,
    });
    return;
  }
  const { data: trade } = await supabase.from("trades").select("*")
    .eq("id", id).eq("user_id", userId).maybeSingle();
  if (!trade || trade.status !== "open") return;
  const diff = trade.direction === "BUY"
    ? exitPrice - Number(trade.entry_price)
    : Number(trade.entry_price) - exitPrice;
  const pnl = diff * 100 * Number(trade.lot_size);
  await supabase.from("trades").update({
    status: "closed",
    exit_price: exitPrice,
    reason_exit: reason,
    pnl,
    closed_at: new Date().toISOString(),
  }).eq("id", id);

  const { data: acct } = await supabase.from("paper_account").select("*")
    .eq("user_id", userId).maybeSingle();
  if (acct) {
    const bal = Number(acct.balance) + pnl;
    await supabase.from("paper_account").update({
      balance: bal, equity: bal, free_margin: bal, updated_at: new Date().toISOString(),
    }).eq("user_id", userId);
  }
}
