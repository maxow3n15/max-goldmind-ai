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
  /** Who initiated the order. Manual orders skip the AI-specific gates. */
  source: z.enum(["auto", "manual"]).default("auto"),
  environment: z.string().max(200).nullable().optional(),
});

/**
 * Places a live order on the user's default broker account.
 * Every pre-flight safety rule is enforced server-side in the shared core —
 * the browser cannot bypass it.
 */
export const placeLiveOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => LiveOrderInput.parse(d))
  .handler(async ({ data, context }) => {
    const { placeLiveOrderCore } = await import("@/lib/brokers/live-execution.server");
    return placeLiveOrderCore(context.supabase, context.userId, data);
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
    const { closeLiveOrderCore } = await import("@/lib/brokers/live-execution.server");
    return closeLiveOrderCore(context.supabase, context.userId, data);
  });

const ModifyLiveInput = z.object({ id: z.string().uuid(), stop_loss: z.number().positive() });

export const modifyLiveOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ModifyLiveInput.parse(d))
  .handler(async ({ data, context }) => {
    const { modifyLiveOrderCore } = await import("@/lib/brokers/live-execution.server");
    return modifyLiveOrderCore(context.supabase, context.userId, data);
  });
