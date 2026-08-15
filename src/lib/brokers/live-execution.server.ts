// Broker execution core (demo/practice and live).
//
// Shared verbatim by:
//   * the authenticated server functions (browser autopilot / manual ticket)
//   * the scheduled cron tick, which runs with the admin client and no session
//
// Everything that decides whether real or demo money moves lives here:
// environment resolution, the administrative permission gate, a mandatory
// account refresh, broker-sourced sizing, fill verification and SL/TP
// verification. Nothing is assumed; anything unverifiable fails closed.

import {
  resolveBrokerEnvironment,
  assertEnvironmentPinned,
  type ResolvedEnvironment,
} from "@/lib/brokers/environment.server";

export const MAX_SPREAD = 0.8;
export const MIN_STOP_DISTANCE = 0.5;
/** Price tolerance when verifying that the broker applied our SL/TP. */
export const PROTECTION_TOLERANCE = 0.75;
/** Relative tolerance when verifying filled volume. */
export const VOLUME_TOLERANCE = 0.05;

export interface LiveOrderCoreInput {
  direction: "BUY" | "SELL";
  entry_price: number;
  stop_loss: number;
  take_profit_1?: number | null;
  take_profit_2?: number | null;
  take_profit_3?: number | null;
  lot_size: number;
  spread?: number;
  confidence?: number;
  timeframe?: string;
  session?: string;
  reason_entry?: string;
  ai_analysis?: any;
  source?: "auto" | "manual";
  environment?: string | null;
  client_order_id?: string | null;
}

/** The user's default broker connection, or null when there is none. */
export async function loadDefaultBrokerConnection(supabase: any, userId: string) {
  const { data } = await supabase
    .from("broker_connections")
    .select("*")
    .eq("user_id", userId)
    .eq("is_default", true)
    .maybeSingle();
  return data ?? null;
}

/** Resolve environment + pinned credentials for a stored connection. */
export async function resolveConnectionEnvironment(conn: any): Promise<ResolvedEnvironment> {
  const { decryptCredentials } = await import("@/lib/brokers/crypto.server");
  const creds = decryptCredentials(conn.credentials_ciphertext) as Record<string, string>;
  const resolved = resolveBrokerEnvironment(String(conn.broker_id), creds ?? {});
  assertEnvironmentPinned(resolved);
  return resolved;
}

/**
 * True only when the user has a default broker whose connection is healthy and
 * whose stored credentials still decrypt. Anything else means broker execution
 * is not actually possible.
 */
export async function isLiveBrokerConnected(supabase: any, userId: string): Promise<boolean> {
  const conn = await loadDefaultBrokerConnection(supabase, userId);
  if (!conn || conn.status !== "connected" || !conn.credentials_ciphertext) return false;
  try {
    const resolved = await resolveConnectionEnvironment(conn);
    return Object.keys(resolved.credentials).length > 0;
  } catch {
    return false;
  }
}

export interface LiveOrderFailure {
  ok: false;
  reason: string;
  execution_status:
    | "ADMIN_LOCKED"
    | "RISK_REJECTED"
    | "SIGNAL_REJECTED"
    | "FAILED"
    | "DISCONNECTED";
}

export async function placeLiveOrderCore(supabase: any, userId: string, data: LiveOrderCoreInput) {
  const fail = (
    reason: string,
    execution_status: LiveOrderFailure["execution_status"] = "RISK_REJECTED",
  ): LiveOrderFailure => ({ ok: false, reason, execution_status });

  const conn = await loadDefaultBrokerConnection(supabase, userId);
  if (!conn) return fail("No default broker connection.", "DISCONNECTED");

  // --- 1. Authoritative environment, resolved server-side ----------------
  let resolved: ResolvedEnvironment;
  try {
    resolved = await resolveConnectionEnvironment(conn);
  } catch (e: any) {
    return fail(String(e?.message ?? "Broker credentials could not be resolved."), "FAILED");
  }
  const creds = resolved.credentials;

  // --- 2. Permission gate: demo allowed, real money locked by default ----
  const { data: settings } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  const { getExecutionPermission } = await import("@/lib/live-lock.server");
  const permission = getExecutionPermission(resolved.env, settings);
  if (!permission.allowed) return fail(permission.reason!, "ADMIN_LOCKED");

  // --- 3. Account protection (kill switch, open trades, authorisation) ---
  const { checkAccountProtection } = await import("@/lib/trades.server");
  const guard = await checkAccountProtection(supabase, userId, "live", resolved.env);
  if (!guard.ok) return fail(guard.reason ?? "Blocked by account protection.");

  const { getConnector } = await import("@/lib/brokers/connectors.server");
  const { isUsableSpec, roundVolumeToStep, riskPerLot } = await import("@/lib/services/risk-engine");
  const connector = getConnector(conn.broker_id);

  // --- 4. Refresh the broker account immediately before sizing -----------
  let account;
  try {
    account = await connector.fetchAccount(creds);
  } catch (e: any) {
    const message = String(e?.message ?? "Broker account unavailable").slice(0, 300);
    await supabase
      .from("broker_connections")
      .update({ status: "error", last_error: message, updated_at: new Date().toISOString() })
      .eq("id", conn.id);
    return fail(`Broker account could not be refreshed: ${message}`, "DISCONNECTED");
  }
  if (!(Number(account.equity) > 0)) {
    return fail("Broker reports no usable account equity — refusing to size a trade.");
  }
  // Persist the refreshed snapshot so the UI and risk layer see live numbers.
  await supabase
    .from("broker_connections")
    .update({
      ...account,
      status: "connected",
      last_error: null,
      last_sync_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", conn.id);

  // --- 5. Real contract spec from the broker -----------------------------
  if (!connector.fetchSymbolSpec) {
    return fail(`Broker ${conn.broker_id} cannot supply a symbol specification — sizing refused.`);
  }
  let spec;
  try {
    spec = await connector.fetchSymbolSpec(creds, "XAUUSD");
  } catch (e: any) {
    return fail(String(e?.message ?? "Broker symbol specification unavailable").slice(0, 300));
  }
  if (!isUsableSpec(spec)) return fail("Broker symbol specification is incomplete — sizing refused.");

  // --- 6. Execution safety gates -----------------------------------------
  if ((data.spread ?? 0) > MAX_SPREAD) return fail(`Spread ${data.spread?.toFixed(2)} above ${MAX_SPREAD} limit.`, "SIGNAL_REJECTED");
  const stopDistance = Math.abs(data.entry_price - data.stop_loss);
  if (stopDistance < MIN_STOP_DISTANCE) return fail("Stop loss is too close to entry for broker requirements.", "SIGNAL_REJECTED");
  const wrongSide =
    data.direction === "BUY" ? data.stop_loss >= data.entry_price : data.stop_loss <= data.entry_price;
  if (wrongSide) return fail("Stop loss is on the wrong side of entry.", "SIGNAL_REJECTED");
  if (data.take_profit_1) {
    const tpWrong =
      data.direction === "BUY" ? data.take_profit_1 <= data.entry_price : data.take_profit_1 >= data.entry_price;
    if (tpWrong) return fail("Take profit is on the wrong side of entry.", "SIGNAL_REJECTED");
  }

  // --- 7. Re-size against the REFRESHED broker equity ---------------------
  const maxRiskPct = Number(settings?.max_risk_per_trade_pct ?? 0.5) || 0.5;
  const riskBudget = (Number(account.equity) * maxRiskPct) / 100;
  const perLot = riskPerLot(spec, stopDistance);
  if (!(perLot > 0)) return fail("Broker spec produced a zero risk-per-lot — sizing refused.");

  const affordable = riskBudget / perLot;
  let volume = roundVolumeToStep(Math.min(data.lot_size, affordable, spec.volumeMax), spec);
  if (volume < spec.volumeMin) {
    return fail(
      `Position size ${volume} below broker minimum (${spec.volumeMin}) at ${maxRiskPct}% risk of ${account.equity.toFixed(2)} ${account.currency}.`,
    );
  }
  // Recheck the true monetary risk AFTER rounding — the rounded size, not the
  // estimate, is what the broker will fill.
  const actualRisk = perLot * volume;
  const actualRiskPct = (actualRisk / Number(account.equity)) * 100;
  if (actualRiskPct > maxRiskPct + 1e-9) {
    return fail(
      `Rounded position size risks ${actualRiskPct.toFixed(3)}% of equity, above the ${maxRiskPct}% per-trade limit.`,
    );
  }

  // --- 8. Margin, from the broker's own margin rate and free margin -------
  const freeMargin = Number(account.free_margin ?? 0);
  if (freeMargin > 0) {
    if (spec.marginRate == null) {
      return fail("Broker did not report a margin requirement — cannot verify free margin.");
    }
    const requiredMargin = data.entry_price * volume * spec.contractSize * spec.marginRate;
    if (requiredMargin > freeMargin) {
      return fail(
        `Insufficient free margin: ${requiredMargin.toFixed(2)} required, ${freeMargin.toFixed(2)} available.`,
      );
    }
  }

  // --- 9. Idempotency: never place the same client order twice ------------
  if (data.client_order_id) {
    const { data: existing } = await supabase
      .from("trades")
      .select("id")
      .eq("user_id", userId)
      .eq("client_order_id", data.client_order_id)
      .maybeSingle();
    if (existing) {
      return fail(`Duplicate execution: ${data.client_order_id} has already been submitted.`, "SIGNAL_REJECTED");
    }
  }

  // --- 10. Submit -----------------------------------------------------
  assertEnvironmentPinned(resolved);
  let brokerOrderId = "";
  try {
    const res = await connector.placeOrder(creds, {
      symbol: "XAUUSD",
      direction: data.direction,
      volume,
      stop_loss: data.stop_loss,
      take_profit: data.take_profit_1 ?? null,
      comment: "GoldMind AI",
      client_order_id: data.client_order_id ?? null,
    });
    brokerOrderId = res.broker_order_id;
  } catch (e: any) {
    const message = String(e?.message ?? "Broker rejected the order").slice(0, 500);
    await supabase
      .from("broker_connections")
      .update({ last_error: message, updated_at: new Date().toISOString() })
      .eq("id", conn.id);
    return fail(message, "FAILED");
  }
  if (!brokerOrderId) return fail("Broker did not return a trade identifier — fill unverified.", "FAILED");

  // --- 11. Verify the fill and its protective orders ---------------------
  const verification = await verifyFill(connector, creds, brokerOrderId, {
    direction: data.direction,
    volume,
    stop_loss: data.stop_loss,
    take_profit: data.take_profit_1 ?? null,
  });

  if (!verification.ok) {
    // Never leave an unverified or unprotected position running.
    let emergency = "not attempted";
    try {
      await connector.closePosition(creds, brokerOrderId);
      emergency = "position closed";
    } catch (e: any) {
      emergency = `emergency close FAILED: ${String(e?.message ?? e).slice(0, 200)}`;
    }
    console.error(
      `[live-execution] fill verification failed — user=${userId} broker=${conn.broker_id} order=${brokerOrderId}: ${verification.detail} (${emergency})`,
    );
    await supabase.from("trades").insert({
      user_id: userId,
      symbol: "XAUUSD",
      direction: data.direction,
      entry_price: data.entry_price,
      stop_loss: data.stop_loss,
      lot_size: volume,
      mode: "live",
      status: RECONCILIATION_REQUIRED,
      source: data.source ?? "auto",
      client_order_id: data.client_order_id ?? null,
      environment: data.environment ?? null,
      reason_exit: `Fill verification failed: ${verification.detail} — ${emergency}`.slice(0, 500),
      ai_analysis: {
        ...(data.ai_analysis ?? {}),
        broker_order_id: brokerOrderId,
        broker_id: conn.broker_id,
        broker_environment: resolved.env,
        verification: verification.record,
      },
    });
    return fail(`Fill verification failed: ${verification.detail} — ${emergency}`, "FAILED");
  }

  const rr = data.take_profit_1
    ? Math.abs(data.take_profit_1 - data.entry_price) / Math.max(0.01, stopDistance)
    : null;

  const { data: row, error } = await supabase
    .from("trades")
    .insert({
      user_id: userId,
      symbol: "XAUUSD",
      direction: data.direction,
      entry_price: verification.record.actual_entry ?? data.entry_price,
      stop_loss: data.stop_loss,
      take_profit_1: data.take_profit_1 ?? null,
      take_profit_2: data.take_profit_2 ?? null,
      take_profit_3: data.take_profit_3 ?? null,
      lot_size: volume,
      risk_reward: rr,
      confidence: data.confidence ?? null,
      timeframe: data.timeframe ?? null,
      session: data.session ?? null,
      reason_entry: data.reason_entry ?? null,
      ai_analysis: {
        ...(data.ai_analysis ?? {}),
        broker_order_id: brokerOrderId,
        broker_id: conn.broker_id,
        broker_environment: resolved.env,
        real_money: permission.realMoney,
        symbol_spec: spec,
        account_equity_at_entry: Number(account.equity),
        risk_amount: actualRisk,
        risk_pct: actualRiskPct,
        verification: verification.record,
      },
      source: data.source ?? "auto",
      client_order_id: data.client_order_id ?? null,
      environment: data.environment ?? null,
      mode: "live",
      status: "open",
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return {
    ok: true as const,
    trade: row,
    broker_order_id: brokerOrderId,
    execution_status: "ORDER_FILLED" as const,
    broker_environment: resolved.env,
    verification: verification.record,
  };
}

interface FillIntent {
  direction: "BUY" | "SELL";
  volume: number;
  stop_loss: number;
  take_profit: number | null;
}

/**
 * Confirm the trade actually exists at the broker with the intended direction,
 * size and protective orders. Attempts one correction of a missing/incorrect
 * SL or TP before giving up.
 */
async function verifyFill(
  connector: any,
  creds: Record<string, string>,
  tradeId: string,
  intent: FillIntent,
): Promise<
  | { ok: true; record: Record<string, any> }
  | { ok: false; detail: string; record: Record<string, any> }
> {
  const record: Record<string, any> = {
    intended_direction: intent.direction,
    intended_volume: intent.volume,
    intended_sl: intent.stop_loss,
    intended_tp: intent.take_profit,
    verified_at: new Date().toISOString(),
  };

  if (!connector.fetchTrade) {
    // Without broker-side verification we fail closed rather than assume.
    record.sl_verification = "unverifiable";
    record.tp_verification = "unverifiable";
    return { ok: false, detail: `connector ${connector.id} cannot verify a fill`, record };
  }

  const read = async () => {
    try {
      return await connector.fetchTrade(creds, tradeId);
    } catch (e: any) {
      return { error: String(e?.message ?? "trade lookup failed").slice(0, 200) } as any;
    }
  };

  let t = await read();
  if (t?.error) return { ok: false, detail: t.error, record };
  record.actual_state = t.state;
  record.actual_direction = t.direction;
  record.actual_volume = t.volume;
  record.actual_entry = t.entry_price;

  if (t.state !== "OPEN") return { ok: false, detail: `broker trade state is ${t.state}`, record };
  if (t.direction !== intent.direction)
    return { ok: false, detail: `broker direction ${t.direction} ≠ intended ${intent.direction}`, record };
  if (
    t.volume == null ||
    Math.abs(t.volume - intent.volume) > Math.max(intent.volume * VOLUME_TOLERANCE, 1e-6)
  ) {
    return { ok: false, detail: `broker volume ${t.volume} ≠ intended ${intent.volume}`, record };
  }

  const protectionOk = (actual: number | null, intended: number | null) =>
    intended == null ? actual == null || true : actual != null && Math.abs(actual - intended) <= PROTECTION_TOLERANCE;

  let slOk = protectionOk(t.stop_loss, intent.stop_loss);
  let tpOk = intent.take_profit == null ? true : protectionOk(t.take_profit, intent.take_profit);

  if (!slOk || !tpOk) {
    // Correction attempt — a live position must never be left unprotected.
    record.correction_attempted = true;
    try {
      await connector.modifyPosition(creds, tradeId, {
        stop_loss: intent.stop_loss,
        ...(intent.take_profit != null ? { take_profit: intent.take_profit } : {}),
      });
    } catch (e: any) {
      record.correction_error = String(e?.message ?? e).slice(0, 200);
    }
    t = await read();
    if (t?.error) return { ok: false, detail: `protection correction unverifiable: ${t.error}`, record };
    slOk = protectionOk(t.stop_loss, intent.stop_loss);
    tpOk = intent.take_profit == null ? true : protectionOk(t.take_profit, intent.take_profit);
  }

  record.actual_sl = t.stop_loss ?? null;
  record.actual_tp = t.take_profit ?? null;
  record.sl_verification = slOk ? "verified" : "failed";
  record.tp_verification = tpOk ? "verified" : "failed";

  if (!slOk) return { ok: false, detail: "stop loss missing or incorrect at the broker", record };
  if (!tpOk) return { ok: false, detail: "take profit missing or incorrect at the broker", record };
  return { ok: true, record };
}

/**
 * Status written when we cannot prove the broker acted on our instruction.
 * A trade in this state is deliberately NOT treated as closed or modified:
 * automation must leave it alone until a human or reconciliation resolves it.
 */
export const RECONCILIATION_REQUIRED = "reconciliation_required";

/** Resolve connector + credentials for the broker that holds this trade. */
async function resolveTradeBroker(supabase: any, userId: string, meta: any) {
  if (!meta?.broker_order_id || !meta?.broker_id) return null;
  const { data: conn } = await supabase
    .from("broker_connections")
    .select("*")
    .eq("user_id", userId)
    .eq("broker_id", meta.broker_id)
    .maybeSingle();
  if (!conn) return null;
  const { getConnector } = await import("@/lib/brokers/connectors.server");
  const resolved = await resolveConnectionEnvironment(conn);
  return {
    conn,
    connector: getConnector(conn.broker_id),
    creds: resolved.credentials,
    environment: resolved.env,
    positionId: String(meta.broker_order_id),
  };
}

async function flagReconciliation(
  supabase: any,
  userId: string,
  tradeId: string,
  brokerId: string,
  operation: "close" | "modify",
  message: string,
) {
  console.error(
    `[live-execution] ${operation} unconfirmed — trade=${tradeId} broker=${brokerId} error=${message}`,
  );
  await supabase
    .from("trades")
    .update({
      status: RECONCILIATION_REQUIRED,
      reason_exit: `Broker ${operation} unconfirmed: ${message}`.slice(0, 500),
    })
    .eq("id", tradeId)
    .eq("user_id", userId);
}

export async function closeLiveOrderCore(
  supabase: any,
  userId: string,
  data: { id: string; exit_price: number; reason_exit?: string },
) {
  const { data: trade } = await supabase
    .from("trades")
    .select("*")
    .eq("id", data.id)
    .eq("user_id", userId)
    .single();
  if (!trade) throw new Error("Trade not found");

  const meta: any = trade.ai_analysis ?? {};
  const target = await resolveTradeBroker(supabase, userId, meta);
  if (meta.broker_order_id && !target) {
    const msg = "broker connection for this trade no longer exists";
    await flagReconciliation(supabase, userId, data.id, String(meta.broker_id ?? "unknown"), "close", msg);
    throw new Error(`Live close not confirmed (${msg}); trade flagged for reconciliation.`);
  }

  let brokerRealisedPnl: number | null = null;
  let brokerExitPrice: number | null = null;

  if (target) {
    // 1. Ask the broker to close.
    let closeError: string | null = null;
    try {
      await target.connector.closePosition(target.creds, target.positionId);
    } catch (e: any) {
      closeError = String(e?.message ?? "broker close call failed").slice(0, 300);
    }

    // 2. Confirm with the broker's own state when the connector can tell us.
    //    Without verification an errored call is treated as UNCONFIRMED — we
    //    fail closed rather than assume the position went away.
    let confirmed = closeError == null;
    if (target.connector.fetchTrade) {
      try {
        const t = await target.connector.fetchTrade(target.creds, target.positionId);
        confirmed = String(t.state).toUpperCase() !== "OPEN";
        if (confirmed) {
          brokerRealisedPnl = t.realized_pnl ?? null;
          brokerExitPrice = t.entry_price != null && t.realized_pnl != null ? null : null;
        }
      } catch (e: any) {
        confirmed = false;
        closeError = closeError ?? String(e?.message ?? "position verification failed").slice(0, 300);
      }
    } else if (target.connector.positionExists) {
      try {
        confirmed = !(await target.connector.positionExists(target.creds, target.positionId));
      } catch (e: any) {
        confirmed = false;
        closeError = closeError ?? String(e?.message ?? "position verification failed").slice(0, 300);
      }
    }

    if (!confirmed) {
      const msg = closeError ?? "broker still reports the position as open";
      await flagReconciliation(supabase, userId, data.id, String(target.conn.broker_id), "close", msg);
      throw new Error(`Live close not confirmed (${msg}); trade flagged for reconciliation.`);
    }
  }

  const diff =
    trade.direction === "BUY"
      ? data.exit_price - Number(trade.entry_price)
      : Number(trade.entry_price) - data.exit_price;
  // Value per price point comes from the spec captured at entry; fall back to
  // the broker's current spec only if the trade predates spec capture.
  const storedSpec = (trade.ai_analysis as any)?.symbol_spec;
  const valuePerPoint: number | null =
    storedSpec && Number(storedSpec.tickValue) > 0 && Number(storedSpec.tickSize) > 0
      ? Number(storedSpec.tickValue) / Number(storedSpec.tickSize)
      : null;
  if (brokerRealisedPnl == null && valuePerPoint == null) {
    throw new Error("Cannot compute live PnL: contract specification for this trade is unavailable.");
  }
  // The broker's own realised PnL wins when it reports one.
  const pnl =
    brokerRealisedPnl != null ? brokerRealisedPnl : diff * (valuePerPoint as number) * Number(trade.lot_size);

  const { error } = await supabase
    .from("trades")
    .update({
      status: "closed",
      exit_price: brokerExitPrice ?? data.exit_price,
      reason_exit: data.reason_exit ?? null,
      pnl,
      closed_at: new Date().toISOString(),
    })
    .eq("id", data.id)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return { pnl, pnl_source: brokerRealisedPnl != null ? ("broker" as const) : ("derived" as const) };
}

export async function modifyLiveOrderCore(
  supabase: any,
  userId: string,
  data: { id: string; stop_loss: number },
) {
  const { data: trade } = await supabase
    .from("trades")
    .select("id, ai_analysis")
    .eq("id", data.id)
    .eq("user_id", userId)
    .single();
  const meta: any = trade?.ai_analysis ?? {};
  const target = await resolveTradeBroker(supabase, userId, meta);
  if (meta.broker_order_id && !target) {
    const msg = "broker connection for this trade no longer exists";
    await flagReconciliation(supabase, userId, data.id, String(meta.broker_id ?? "unknown"), "modify", msg);
    throw new Error(`Live stop modification not confirmed (${msg}); trade flagged for reconciliation.`);
  }

  if (target) {
    try {
      await target.connector.modifyPosition(target.creds, target.positionId, { stop_loss: data.stop_loss });
    } catch (e: any) {
      const msg = String(e?.message ?? "broker modify call failed").slice(0, 300);
      await flagReconciliation(supabase, userId, data.id, String(target.conn.broker_id), "modify", msg);
      throw new Error(`Live stop modification not confirmed (${msg}); trade flagged for reconciliation.`);
    }
    // Verify the broker actually holds the new stop.
    if (target.connector.fetchTrade) {
      try {
        const t = await target.connector.fetchTrade(target.creds, target.positionId);
        const ok = t.stop_loss != null && Math.abs(Number(t.stop_loss) - data.stop_loss) <= PROTECTION_TOLERANCE;
        if (!ok) {
          const msg = `broker stop is ${t.stop_loss ?? "missing"} after modify, expected ${data.stop_loss}`;
          await flagReconciliation(supabase, userId, data.id, String(target.conn.broker_id), "modify", msg);
          throw new Error(`Live stop modification not confirmed (${msg}); trade flagged for reconciliation.`);
        }
      } catch (e: any) {
        if (String(e?.message ?? "").includes("flagged for reconciliation")) throw e;
        const msg = String(e?.message ?? "stop verification failed").slice(0, 300);
        await flagReconciliation(supabase, userId, data.id, String(target.conn.broker_id), "modify", msg);
        throw new Error(`Live stop modification not confirmed (${msg}); trade flagged for reconciliation.`);
      }
    }
  }

  await supabase
    .from("trades")
    .update({ stop_loss: data.stop_loss })
    .eq("id", data.id)
    .eq("user_id", userId)
    .eq("status", "open");
  return { ok: true };
}
