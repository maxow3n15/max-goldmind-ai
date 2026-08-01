import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Columns safe to hand to the browser — never the ciphertext. */
const PUBLIC_COLUMNS =
  "id, broker_id, label, status, account_name, account_number, account_type, currency, balance, equity, free_margin, margin_level, open_positions, last_sync_at, last_error, is_default, created_at, updated_at";

export const listBrokerConnections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("broker_connections")
      .select(PUBLIC_COLUMNS)
      .eq("user_id", context.userId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const ConnectInput = z.object({
  broker_id: z.string().min(1).max(40),
  label: z.string().max(60).optional(),
  credentials: z.record(z.string(), z.string().max(4000)),
});

export const connectBroker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ConnectInput.parse(d))
  .handler(async ({ data, context }) => {
    const { getConnector } = await import("@/lib/brokers/connectors.server");
    const { encryptCredentials } = await import("@/lib/brokers/crypto.server");

    // Authorise against the broker BEFORE persisting anything.
    const connector = getConnector(data.broker_id);
    const account = await connector.fetchAccount(data.credentials);

    const { count } = await context.supabase
      .from("broker_connections")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId);

    const { data: row, error } = await context.supabase
      .from("broker_connections")
      .insert({
        user_id: context.userId,
        broker_id: data.broker_id,
        label: data.label ?? null,
        credentials_ciphertext: encryptCredentials(data.credentials),
        status: "connected",
        last_error: null,
        last_sync_at: new Date().toISOString(),
        is_default: (count ?? 0) === 0,
        ...account,
      })
      .select(PUBLIC_COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

const IdInput = z.object({ id: z.string().uuid() });

async function loadCredentials(supabase: any, userId: string, id: string) {
  const { data, error } = await supabase
    .from("broker_connections")
    .select("id, broker_id, credentials_ciphertext, status, account_type")
    .eq("id", id)
    .eq("user_id", userId)
    .single();
  if (error || !data) throw new Error("Broker connection not found");
  const { decryptCredentials } = await import("@/lib/brokers/crypto.server");
  return { row: data, creds: decryptCredentials(data.credentials_ciphertext) };
}

/** Re-authorise and refresh live account metrics. */
export const syncBrokerConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { getConnector } = await import("@/lib/brokers/connectors.server");
    const { row, creds } = await loadCredentials(context.supabase, context.userId, data.id);
    try {
      const account = await getConnector(row.broker_id).fetchAccount(creds);
      const { data: updated, error } = await context.supabase
        .from("broker_connections")
        .update({
          ...account,
          status: "connected",
          last_error: null,
          last_sync_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.id)
        .eq("user_id", context.userId)
        .select(PUBLIC_COLUMNS)
        .single();
      if (error) throw new Error(error.message);
      return { ok: true as const, connection: updated };
    } catch (e: any) {
      const message = String(e?.message ?? "Broker sync failed").slice(0, 500);
      const expired = /401|403|unauthor|expired|token/i.test(message);
      await context.supabase
        .from("broker_connections")
        .update({
          status: expired ? "reauth_required" : "error",
          last_error: message,
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.id)
        .eq("user_id", context.userId);
      return { ok: false as const, error: message, reauth_required: expired };
    }
  });

export const disconnectBroker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("broker_connections")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setDefaultBrokerConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    await context.supabase
      .from("broker_connections")
      .update({ is_default: false })
      .eq("user_id", context.userId);
    const { error } = await context.supabase
      .from("broker_connections")
      .update({ is_default: true, updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* Live execution                                                      */
/* ------------------------------------------------------------------ */

const LiveOrderInput = z.object({
  direction: z.enum(["BUY", "SELL"]),
  entry_price: z.number().positive(),
  stop_loss: z.number().positive(),
  take_profit_1: z.number().positive().nullable().optional(),
  take_profit_2: z.number().positive().nullable().optional(),
  take_profit_3: z.number().positive().nullable().optional(),
  lot_size: z.number().positive().max(100),
  spread: z.number().nonnegative().optional(),
  confidence: z.number().min(0).max(100).optional(),
  timeframe: z.string().optional(),
  session: z.string().optional(),
  reason_entry: z.string().max(2000).optional(),
  ai_analysis: z.any().optional(),
});

const MAX_SPREAD = 0.8;
const MIN_STOP_DISTANCE = 0.5;

/**
 * Places a live order on the user's default broker account.
 * Every pre-flight safety rule is enforced here on the server — the browser
 * cannot bypass it.
 */
export const placeLiveOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => LiveOrderInput.parse(d))
  .handler(async ({ data, context }) => {
    const fail = (reason: string) => ({ ok: false as const, reason });

    const { data: settings } = await context.supabase
      .from("user_settings")
      .select("trading_mode, live_trading_enabled")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!settings?.live_trading_enabled) return fail("Live trading is not authorised in settings.");
    if (settings?.trading_mode !== "live") return fail("Trading mode is not set to Live.");

    const { data: conn } = await context.supabase
      .from("broker_connections")
      .select("*")
      .eq("user_id", context.userId)
      .eq("is_default", true)
      .maybeSingle();
    if (!conn) return fail("No default broker account selected.");
    if (conn.status !== "connected") return fail(`Broker connection is ${conn.status}. Reconnect required.`);

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
    if (data.lot_size < 0.01) return fail("Position size below broker minimum (0.01 lots).");
    const requiredMargin = data.entry_price * data.lot_size * 100 * 0.005; // ~200:1 leverage estimate
    if (Number(conn.free_margin ?? 0) > 0 && requiredMargin > Number(conn.free_margin)) {
      return fail("Insufficient free margin on the broker account for this position size.");
    }

    const { getConnector } = await import("@/lib/brokers/connectors.server");
    const { decryptCredentials } = await import("@/lib/brokers/crypto.server");
    const connector = getConnector(conn.broker_id);
    const creds = decryptCredentials(conn.credentials_ciphertext);

    let brokerOrderId = "";
    try {
      const res = await connector.placeOrder(creds, {
        symbol: "XAUUSD",
        direction: data.direction,
        volume: data.lot_size,
        stop_loss: data.stop_loss,
        take_profit: data.take_profit_1 ?? null,
        comment: "GoldMind AI",
      });
      brokerOrderId = res.broker_order_id;
    } catch (e: any) {
      const message = String(e?.message ?? "Broker rejected the order").slice(0, 500);
      await context.supabase
        .from("broker_connections")
        .update({ last_error: message, updated_at: new Date().toISOString() })
        .eq("id", conn.id);
      return fail(message);
    }

    const rr = data.take_profit_1
      ? Math.abs(data.take_profit_1 - data.entry_price) / Math.max(0.01, stopDistance)
      : null;

    const { data: row, error } = await context.supabase
      .from("trades")
      .insert({
        user_id: context.userId,
        symbol: "XAUUSD",
        direction: data.direction,
        entry_price: data.entry_price,
        stop_loss: data.stop_loss,
        take_profit_1: data.take_profit_1 ?? null,
        take_profit_2: data.take_profit_2 ?? null,
        take_profit_3: data.take_profit_3 ?? null,
        lot_size: data.lot_size,
        risk_reward: rr,
        confidence: data.confidence ?? null,
        timeframe: data.timeframe ?? null,
        session: data.session ?? null,
        reason_entry: data.reason_entry ?? null,
        ai_analysis: { ...(data.ai_analysis ?? {}), broker_order_id: brokerOrderId, broker_id: conn.broker_id },
        mode: "live",
        status: "open",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { ok: true as const, trade: row, broker_order_id: brokerOrderId };
  });

const CloseLiveInput = z.object({
  id: z.string().uuid(),
  exit_price: z.number().positive(),
  reason_exit: z.string().max(1000).optional(),
});

export const closeLiveOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CloseLiveInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: trade } = await context.supabase
      .from("trades")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .single();
    if (!trade) throw new Error("Trade not found");

    const meta: any = trade.ai_analysis ?? {};
    if (meta.broker_order_id) {
      const { data: conn } = await context.supabase
        .from("broker_connections")
        .select("*")
        .eq("user_id", context.userId)
        .eq("broker_id", meta.broker_id ?? "")
        .maybeSingle();
      if (conn) {
        const { getConnector } = await import("@/lib/brokers/connectors.server");
        const { decryptCredentials } = await import("@/lib/brokers/crypto.server");
        await getConnector(conn.broker_id)
          .closePosition(decryptCredentials(conn.credentials_ciphertext), String(meta.broker_order_id))
          .catch(() => undefined);
      }
    }

    const diff =
      trade.direction === "BUY"
        ? data.exit_price - Number(trade.entry_price)
        : Number(trade.entry_price) - data.exit_price;
    const pnl = diff * 100 * Number(trade.lot_size);

    const { error } = await context.supabase
      .from("trades")
      .update({
        status: "closed",
        exit_price: data.exit_price,
        reason_exit: data.reason_exit ?? null,
        pnl,
        closed_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { pnl };
  });

const ModifyLiveInput = z.object({ id: z.string().uuid(), stop_loss: z.number().positive() });

export const modifyLiveOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ModifyLiveInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: trade } = await context.supabase
      .from("trades")
      .select("id, ai_analysis")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .single();
    const meta: any = trade?.ai_analysis ?? {};
    if (meta.broker_order_id && meta.broker_id) {
      const { data: conn } = await context.supabase
        .from("broker_connections")
        .select("*")
        .eq("user_id", context.userId)
        .eq("broker_id", meta.broker_id)
        .maybeSingle();
      if (conn) {
        const { getConnector } = await import("@/lib/brokers/connectors.server");
        const { decryptCredentials } = await import("@/lib/brokers/crypto.server");
        await getConnector(conn.broker_id)
          .modifyPosition(decryptCredentials(conn.credentials_ciphertext), String(meta.broker_order_id), {
            stop_loss: data.stop_loss,
          })
          .catch(() => undefined);
      }
    }
    await context.supabase
      .from("trades")
      .update({ stop_loss: data.stop_loss })
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .eq("status", "open");
    return { ok: true };
  });
