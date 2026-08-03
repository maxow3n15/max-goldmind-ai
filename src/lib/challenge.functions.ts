import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";


const ProfileInput = z.object({
  id: z.string().uuid().nullable().optional(),
  broker_connection_id: z.string().uuid().nullable().optional(),
  label: z.string().trim().min(1).max(80),
  provider: z.string().trim().min(1).max(60),
  preset_key: z.string().trim().min(1).max(40),
  phase: z.enum(["evaluation_1", "evaluation_2", "funded"]),
  account_size: z.number().positive().max(10_000_000),
  currency: z.string().trim().min(1).max(8).default("USD"),
  profit_target_pct: z.number().min(0).max(100),
  daily_loss_limit_pct: z.number().min(0.1).max(100),
  max_drawdown_pct: z.number().min(0.1).max(100),
  drawdown_type: z.enum(["static", "trailing", "eod_trailing"]),
  drawdown_basis: z.enum(["equity", "balance"]),
  daily_loss_basis: z.enum(["balance", "equity"]),
  consistency_rule_pct: z.number().min(1).max(100).nullable().optional(),
  min_trading_days: z.number().int().min(0).max(365),
  max_trading_days: z.number().int().min(1).max(365).nullable().optional(),
  news_restriction_minutes: z.number().int().min(0).max(240),
  weekend_holding_allowed: z.boolean(),
  overnight_holding_allowed: z.boolean(),
  max_lot_size: z.number().positive().max(100).nullable().optional(),
  daily_reset_utc_hour: z.number().int().min(0).max(23),
  start_balance: z.number().positive().max(10_000_000),
  status: z.enum(["active", "passed", "failed", "paused"]).default("active"),
  auto_enforce: z.boolean().default(true),
  safety_buffer_pct: z.number().min(0).max(60).default(20),
  notes: z.string().max(2000).nullable().optional(),
});

export const listChallengeProfiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("challenge_profiles")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const saveChallengeProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ProfileInput.parse(d))
  .handler(async ({ data, context }) => {
    const { id, ...rest } = data;
    const row = { ...rest, user_id: context.userId };
    if (id) {
      const { data: updated, error } = await context.supabase
        .from("challenge_profiles").update(row)
        .eq("id", id).eq("user_id", context.userId).select().single();
      if (error) throw new Error(error.message);
      return updated;
    }
    const { data: created, error } = await context.supabase
      .from("challenge_profiles").insert(row).select().single();
    if (error) throw new Error(error.message);
    return created;
  });

export const deleteChallengeProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("challenge_profiles").delete().eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const StatusInput = z.object({ id: z.string().uuid().nullable().optional() });

/**
 * Full compliance read for one challenge account: rebuilds the equity
 * timeline from stored trades, anchors every day to the provider's reset
 * hour, evaluates each objective, and persists the daily statistics so the
 * history survives even if trades are later archived.
 */
export const getChallengeStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => StatusInput.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { computeChallengeStatus } = await import("@/lib/challenge/status.server");
    return computeChallengeStatus(context.supabase, context.userId, data.id ?? null);
  });

