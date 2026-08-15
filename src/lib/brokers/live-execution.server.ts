// Live broker execution core.
//
// The exact logic that used to live inline in brokers.functions.ts, lifted so
// both callers can share it verbatim:
//   * the authenticated server functions (browser autopilot / manual ticket)
//   * the scheduled cron tick, which runs with the admin client and no session
//
// No broker logic is added here — same connector resolution, same credential
// handling, same safety gates, same DB writes.

export const MAX_SPREAD = 0.8;
export const MIN_STOP_DISTANCE = 0.5;

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

/**
 * True only when the user has a default broker whose connection is healthy and
 * whose stored credentials still decrypt. Anything else means live execution
 * is not actually possible.
 */
export async function isLiveBrokerConnected(supabase: any, userId: string): Promise<boolean> {
  const conn = await loadDefaultBrokerConnection(supabase, userId);
  if (!conn || conn.status !== "connected" || !conn.credentials_ciphertext) return false;
  try {
    const { decryptCredentials } = await import("@/lib/brokers/crypto.server");
    const creds = decryptCredentials(conn.credentials_ciphertext);
    return !!creds && Object.keys(creds as any).length > 0;
  } catch {
    return false;
  }
}

export async function placeLiveOrderCore(
  supabase: any,
  userId: string,
  data: LiveOrderCoreInput,
) {
  const fail = (reason: string) => ({ ok: false as const, reason });

  // Hard administrative lock, checked first and independently of the account
  // protection gate so neither path can be the single point of failure.
  const { getLiveExecutionLock } = await import("@/lib/live-lock.server");
  const lock = getLiveExecutionLock();
  if (lock.locked) return fail(lock.reason!);

  const { checkAccountProtection } = await import("@/lib/trades.server");
  const guard = await checkAccountProtection(supabase, userId, "live");
  if (!guard.ok) return fail(guard.reason ?? "Blocked by account protection.");

  const conn = await loadDefaultBrokerConnection(supabase, userId);
  if (!conn) return fail("No default broker connection.");

  const { getConnector } = await import("@/lib/brokers/connectors.server");
  const { decryptCredentials } = await import("@/lib/brokers/crypto.server");
  const { isUsableSpec, roundVolumeToStep } = await import("@/lib/services/risk-engine");
  const connector = getConnector(conn.broker_id);
  const creds = decryptCredentials(conn.credentials_ciphertext);

  // Real contract spec from the broker — never an assumed gold contract.
  if (!connector.fetchSymbolSpec) {
    return fail(`Broker ${conn.broker_id} cannot supply a symbol specification — live sizing refused.`);
  }
  let spec;
  try {
    spec = await connector.fetchSymbolSpec(creds, "XAUUSD");
  } catch (e: any) {
    return fail(String(e?.message ?? "Broker symbol specification unavailable").slice(0, 300));
  }
  if (!isUsableSpec(spec)) return fail("Broker symbol specification is incomplete — live sizing refused.");

  // --- execution safety gates ---
  if ((data.spread ?? 0) > MAX_SPREAD) return fail(`Spread ${data.spread?.toFixed(2)} above ${MAX_SPREAD} limit.`);
  const stopDistance = Math.abs(data.entry_price - data.stop_loss);
  if (stopDistance < MIN_STOP_DISTANCE) return fail("Stop loss is too close to entry for broker requirements.");
  const wrongSide =
    data.direction === "BUY" ? data.stop_loss >= data.entry_price : data.stop_loss <= data.entry_price;
  if (wrongSide) return fail("Stop loss is on the wrong side of entry.");
  if (data.take_profit_1) {
    const tpWrong =
      data.direction === "BUY" ? data.take_profit_1 <= data.entry_price : data.take_profit_1 >= data.entry_price;
    if (tpWrong) return fail("Take profit is on the wrong side of entry.");
  }

  // Volume must respect the broker's real min / max / step.
  const volume = roundVolumeToStep(Math.min(data.lot_size, spec.volumeMax), spec);
  if (volume < spec.volumeMin) {
    return fail(`Position size ${volume} below broker minimum (${spec.volumeMin} lots).`);
  }

  // Margin from the broker's actual margin rate — no assumed leverage.
  if (Number(conn.free_margin ?? 0) > 0) {
    if (spec.marginRate == null) {
      return fail("Broker did not report a margin requirement — cannot verify free margin.");
    }
    const requiredMargin = data.entry_price * volume * spec.contractSize * spec.marginRate;
    if (requiredMargin > Number(conn.free_margin)) {
      return fail("Insufficient free margin on the broker account for this position size.");
    }
  }


  let brokerOrderId = "";
  try {
    const res = await connector.placeOrder(creds, {
      symbol: "XAUUSD",
      direction: data.direction,
      volume,
      stop_loss: data.stop_loss,
      take_profit: data.take_profit_1 ?? null,
      comment: "GoldMind AI",
    });
    brokerOrderId = res.broker_order_id;
  } catch (e: any) {
    const message = String(e?.message ?? "Broker rejected the order").slice(0, 500);
    await supabase
      .from("broker_connections")
      .update({ last_error: message, updated_at: new Date().toISOString() })
      .eq("id", conn.id);
    return fail(message);
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
      entry_price: data.entry_price,
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
        symbol_spec: spec,
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
  return { ok: true as const, trade: row, broker_order_id: brokerOrderId };
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
  const { decryptCredentials } = await import("@/lib/brokers/crypto.server");
  return {
    conn,
    connector: getConnector(conn.broker_id),
    creds: decryptCredentials(conn.credentials_ciphertext),
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
    if (target.connector.positionExists) {
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
  if (valuePerPoint == null) {
    throw new Error("Cannot compute live PnL: contract specification for this trade is unavailable.");
  }
  const pnl = diff * valuePerPoint * Number(trade.lot_size);

  const { error } = await supabase
    .from("trades")
    .update({
      status: "closed",
      exit_price: data.exit_price,
      reason_exit: data.reason_exit ?? null,
      pnl,
      closed_at: new Date().toISOString(),
    })
    .eq("id", data.id)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return { pnl };
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
  }

  await supabase
    .from("trades")
    .update({ stop_loss: data.stop_loss })
    .eq("id", data.id)
    .eq("user_id", userId)
    .eq("status", "open");
  return { ok: true };
}

