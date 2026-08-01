import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Execution mode governs how much autonomy the engine has. */
export const EXECUTION_MODES = ["manual", "assisted", "autonomous"] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export const getRiskSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("user_settings").select("*").eq("user_id", context.userId).maybeSingle();
    return data;
  });

const RiskInput = z.object({
  max_risk_per_trade_pct: z.number().min(0.1).max(2),
  max_total_exposure_lots: z.number().min(0.01).max(50),
  max_correlated_trades: z.number().int().min(1).max(10),
  max_drawdown_pct: z.number().min(1).max(50),
  cooldown_minutes: z.number().int().min(0).max(720),
  recovery_mode_enabled: z.boolean(),
});

export const updateRiskSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RiskInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("user_settings")
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const setExecutionMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ execution_mode: z.enum(EXECUTION_MODES) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("user_settings")
      .update({ execution_mode: data.execution_mode, updated_at: new Date().toISOString() })
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** Rotates (or creates) the TradingView webhook token for this account. */
export const rotateWebhookToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const token = crypto.randomUUID().replace(/-/g, "");
    const { error } = await context.supabase
      .from("user_settings")
      .update({ webhook_token: token, webhook_enabled: true, updated_at: new Date().toISOString() })
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const, token };
  });

export const setWebhookEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ enabled: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("user_settings")
      .update({ webhook_enabled: data.enabled, updated_at: new Date().toISOString() })
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const listWebhookSignals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("webhook_signals")
      .select("*")
      .eq("user_id", context.userId)
      .order("received_at", { ascending: false })
      .limit(30);
    return data ?? [];
  });
