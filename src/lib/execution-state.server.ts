// Authoritative execution-state snapshot and the OANDA Practice pipeline test.
// Server-only: the browser renders what this returns and nothing more.

import {
  deriveArming,
  deriveState,
  type ArmingRequirement,
  type ExecutionStateSnapshot,
} from "@/lib/services/execution-state";
import { CONFIDENCE_GATES } from "@/lib/services/scoring";
import { RECONCILIATION_REQUIRED } from "@/lib/brokers/live-execution.server";

const STALE_SYNC_MS = 10 * 60_000;

export async function buildExecutionState(
  supabase: any,
  userId: string,
): Promise<ExecutionStateSnapshot> {
  const [{ data: settings }, { data: conn }, { data: trades }, { data: paper }] = await Promise.all([
    supabase.from("user_settings").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("broker_connections").select("*").eq("user_id", userId).eq("is_default", true).maybeSingle(),
    supabase.from("trades").select("*").eq("user_id", userId).order("opened_at", { ascending: false }).limit(200),
    supabase.from("paper_account").select("*").eq("user_id", userId).maybeSingle(),
  ]);

  const rows = trades ?? [];
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const todayRows = rows.filter((t: any) => t.opened_at && new Date(t.opened_at) >= dayStart);
  const todayPnl = rows
    .filter((t: any) => t.status === "closed" && t.pnl != null && t.closed_at && new Date(t.closed_at) >= dayStart)
    .reduce((a: number, t: any) => a + Number(t.pnl), 0);
  const openTrades = rows.filter((t: any) => t.status === "open").length;
  const reconciliationRequired = rows.filter((t: any) => t.status === RECONCILIATION_REQUIRED).length;

  const tradingMode = settings?.trading_mode === "live" ? "live" : "paper";

  let environment = "paper";
  let environmentLabel = "PAPER (internal simulation)";
  let realMoney = false;
  let credentialsOk = false;

  if (tradingMode === "live" && conn?.credentials_ciphertext) {
    try {
      const { resolveConnectionEnvironment } = await import("@/lib/brokers/live-execution.server");
      const resolved = await resolveConnectionEnvironment(conn);
      environment = resolved.env;
      environmentLabel = resolved.label;
      realMoney = !resolved.isDemo;
      credentialsOk = true;
    } catch {
      environment = "broker_live";
      environmentLabel = "UNRESOLVED BROKER ENVIRONMENT";
      realMoney = true;
    }
  }

  const { getLiveExecutionLock } = await import("@/lib/live-lock.server");
  const lock = getLiveExecutionLock();
  const adminLockedRealMoney = realMoney && lock.locked;

  const lastSync = conn?.last_sync_at ? Date.parse(conn.last_sync_at) : null;
  const stale = lastSync == null || Date.now() - lastSync > STALE_SYNC_MS;
  const brokerConnection: ExecutionStateSnapshot["broker_connection"] =
    tradingMode === "paper"
      ? "CONNECTED"
      : conn?.status === "connected"
        ? stale
          ? "DEGRADED"
          : "CONNECTED"
        : "DISCONNECTED";

  const dailyLossLimitPct = Number(settings?.max_daily_loss ?? 3) || 3;
  const equity =
    tradingMode === "live" ? (conn?.equity != null ? Number(conn.equity) : null) : Number(paper?.equity ?? 0);
  const dailyLossUsedPct = equity && equity > 0 ? (-Math.min(0, todayPnl) / equity) * 100 : 0;

  const requirements: ArmingRequirement[] = [
    {
      key: "auto_execute",
      label: "Auto-execution enabled",
      ok: !!settings?.auto_execute,
      detail: "Auto-execution is switched off",
    },
    {
      key: "kill_switch",
      label: "Kill switch off",
      ok: !settings?.kill_switch_active,
      detail: `Kill switch active — ${settings?.kill_switch_reason ?? "trading halted"}`,
    },
    {
      key: "broker",
      label: tradingMode === "paper" ? "Paper engine ready" : "Broker connected",
      ok: tradingMode === "paper" ? true : brokerConnection === "CONNECTED" && credentialsOk,
      detail:
        brokerConnection === "DEGRADED"
          ? "Broker account data is stale — heartbeat overdue"
          : "Broker is not connected or credentials cannot be read",
    },
    {
      key: "account_data",
      label: "Account data available",
      ok: tradingMode === "paper" ? true : Number(equity) > 0,
      detail: "No usable account equity reported by the broker",
    },
    {
      key: "risk_settings",
      label: "Risk settings valid",
      ok: Number(settings?.max_risk_per_trade_pct ?? 0.5) > 0 && dailyLossLimitPct > 0,
      detail: "Risk limits are not configured",
    },
    {
      key: "daily_loss",
      label: "Daily loss budget available",
      ok: dailyLossUsedPct < dailyLossLimitPct,
      detail: `Daily loss limit reached (${dailyLossUsedPct.toFixed(2)}% of ${dailyLossLimitPct}%)`,
    },
    {
      key: "reconciliation",
      label: "No unresolved reconciliation",
      ok: reconciliationRequired === 0,
      detail: `${reconciliationRequired} trade(s) awaiting reconciliation`,
    },
    {
      key: "confidence_gate",
      label: `${CONFIDENCE_GATES.FINAL}% confidence gate active`,
      ok: true,
    },
  ];

  const { arming, blocking } = deriveArming({
    autoExecute: !!settings?.auto_execute,
    realMoney,
    adminLocked: lock.locked,
    requirements,
  });

  const state = deriveState({
    arming,
    killSwitch: !!settings?.kill_switch_active,
    adminLockedRealMoney,
    brokerConnected: brokerConnection !== "DISCONNECTED",
    openTrades,
    reconciliationRequired,
  });

  return {
    state,
    arming,
    environment,
    environment_label: environmentLabel,
    real_money: realMoney,
    broker_id: conn?.broker_id ?? null,
    broker_connection: brokerConnection,
    broker_last_check: conn?.last_sync_at ?? null,
    auto_execute: !!settings?.auto_execute,
    kill_switch: {
      active: !!settings?.kill_switch_active,
      reason: settings?.kill_switch_reason ?? null,
      since: settings?.kill_switch_since ?? null,
    },
    admin_lock: { active: lock.locked, reason: lock.reason },
    confidence_threshold: CONFIDENCE_GATES.FINAL,
    account: {
      source: tradingMode === "live" ? `broker:${conn?.broker_id ?? "unknown"}` : "paper_account",
      currency: (tradingMode === "live" ? conn?.currency : "USD") ?? "USD",
      balance: tradingMode === "live" ? (conn?.balance != null ? Number(conn.balance) : null) : Number(paper?.balance ?? 0),
      equity,
      free_margin:
        tradingMode === "live"
          ? conn?.free_margin != null
            ? Number(conn.free_margin)
            : null
          : Number(paper?.free_margin ?? 0),
      open_positions: tradingMode === "live" ? (conn?.open_positions ?? null) : openTrades,
    },
    today: {
      pnl: todayPnl,
      trades: todayRows.length,
      daily_loss_limit_pct: dailyLossLimitPct,
      daily_loss_used_pct: dailyLossUsedPct,
    },
    open_trades: openTrades,
    reconciliation_required: reconciliationRequired,
    requirements,
    blocking_reasons: blocking,
    as_of: new Date().toISOString(),
  };
}

export interface PipelineStep {
  step: string;
  ok: boolean;
  detail: string;
}

/**
 * End-to-end OANDA PRACTICE pipeline test. Refuses to run against anything
 * other than a practice/demo environment and does not bypass any safety gate:
 * it goes through the same placeLiveOrderCore path autonomous trading uses.
 */
export async function runPracticeExecutionTest(
  supabase: any,
  userId: string,
  opts: { placeOrder: boolean },
): Promise<{ ok: boolean; environment: string | null; steps: PipelineStep[] }> {
  const steps: PipelineStep[] = [];
  const add = (step: string, ok: boolean, detail: string) => {
    steps.push({ step, ok, detail });
    return ok;
  };

  const { loadDefaultBrokerConnection, resolveConnectionEnvironment, placeLiveOrderCore, closeLiveOrderCore } =
    await import("@/lib/brokers/live-execution.server");

  const conn = await loadDefaultBrokerConnection(supabase, userId);
  if (!conn) {
    add("connection", false, "No default broker connection");
    return { ok: false, environment: null, steps };
  }

  let resolved;
  try {
    resolved = await resolveConnectionEnvironment(conn);
  } catch (e: any) {
    add("connection", false, String(e?.message ?? e));
    return { ok: false, environment: null, steps };
  }
  add("connection", true, `${resolved.label} (${conn.broker_id})`);

  if (resolved.isDemo !== true) {
    add("environment_guard", false, "Refused: this test only runs against a PRACTICE/DEMO environment");
    return { ok: false, environment: resolved.env, steps };
  }
  add("environment_guard", true, "Practice/demo environment confirmed");

  const { getConnector } = await import("@/lib/brokers/connectors.server");
  const connector = getConnector(conn.broker_id);

  let account: any = null;
  try {
    account = await connector.fetchAccount(resolved.credentials);
    add("account", true, `${account.currency} equity ${Number(account.equity).toFixed(2)}, free margin ${Number(account.free_margin).toFixed(2)}`);
  } catch (e: any) {
    add("account", false, String(e?.message ?? e).slice(0, 200));
    return { ok: false, environment: resolved.env, steps };
  }

  try {
    if (!connector.fetchSymbolSpec) throw new Error("connector cannot supply an instrument specification");
    const spec = await connector.fetchSymbolSpec(resolved.credentials, "XAUUSD");
    const { describeConversion } = await import("@/lib/services/fx");
    add(
      "instrument",
      true,
      `${spec.symbol}: contract ${spec.contractSize}, step ${spec.volumeStep}, min ${spec.volumeMin}, margin ${spec.marginRate ?? "n/a"}, tick value ${spec.tickValue} ${spec.accountCurrency} — ${describeConversion(spec.conversion)}`,
    );

  } catch (e: any) {
    add("instrument", false, String(e?.message ?? e).slice(0, 200));
    return { ok: false, environment: resolved.env, steps };
  }

  const { fetchSpotQuote } = await import("@/lib/services/spot.server");
  const quote = await fetchSpotQuote().catch(() => null);
  if (!quote?.mid) {
    add("price", false, "No live XAUUSD price available");
    return { ok: false, environment: resolved.env, steps };
  }
  add("price", true, `mid ${quote.mid.toFixed(2)}, spread ${(quote.spread ?? 0).toFixed(2)}`);

  if (!opts.placeOrder) {
    add("order", true, "Dry run — order submission skipped (enable order placement to test the full loop)");
    return { ok: true, environment: resolved.env, steps };
  }

  // A deliberately small probe trade, sized by the same core as live signals.
  const entry = quote.mid;
  const stop = entry - 5;
  const target = entry + 5;
  const clientOrderId = `practice-test-${Date.now()}`;

  const placed = await placeLiveOrderCore(supabase, userId, {
    direction: "BUY",
    entry_price: entry,
    stop_loss: stop,
    take_profit_1: target,
    lot_size: 0.01,
    spread: quote.spread ?? undefined,
    reason_entry: "OANDA practice pipeline test",
    source: "manual",
    client_order_id: clientOrderId,
  });

  if (!placed.ok) {
    add("order", false, placed.reason);
    return { ok: false, environment: resolved.env, steps };
  }
  add("order", true, `Filled, broker trade ${placed.broker_order_id}`);
  const v: any = placed.verification ?? {};
  add("sl_verification", v.sl_verification === "verified", `intended ${v.intended_sl} / actual ${v.actual_sl}`);
  add("tp_verification", v.tp_verification === "verified", `intended ${v.intended_tp} / actual ${v.actual_tp}`);

  try {
    const closed = await closeLiveOrderCore(supabase, userId, {
      id: placed.trade.id,
      exit_price: entry,
      reason_exit: "Practice pipeline test complete",
    });
    add("close", true, `Confirmed closed, PnL ${closed.pnl.toFixed(2)} (${closed.pnl_source})`);
  } catch (e: any) {
    add("close", false, String(e?.message ?? e).slice(0, 300));
    return { ok: false, environment: resolved.env, steps };
  }

  const { reconcileUserPositions } = await import("@/lib/services/reconciliation.server");
  const rec = await reconcileUserPositions(supabase, userId);
  add("reconciliation", rec.mismatches.length === 0, `${rec.checked} checked, ${rec.mismatches.length} mismatch(es)`);

  return { ok: steps.every((s) => s.ok), environment: resolved.env, steps };
}
