import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getUserSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("user_settings").select("*").eq("user_id", context.userId).maybeSingle();
    return data;
  });

const UpdateInput = z.object({
  risk_per_trade: z.number().min(0.1).max(10),
  max_daily_loss: z.number().min(0.5).max(50),
  max_weekly_loss: z.number().min(0.5).max(100),
  max_trades_per_day: z.number().int().min(1).max(50),
  max_open_trades: z.number().int().min(1).max(20),
  preferred_timeframe: z.string(),
  preferred_session: z.string(),
  avoid_news: z.boolean(),
  notify_browser: z.boolean(),
  notify_email: z.boolean(),
  live_trading_enabled: z.boolean(),
  auto_execute: z.boolean(),
});

export const updateUserSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UpdateInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("user_settings")
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const TradingModeInput = z.object({ trading_mode: z.enum(["paper", "live"]) });

/**
 * Switches paper / live execution. Live mode requires a connected default
 * broker account — enforced server-side so the UI cannot bypass it.
 */
export const setTradingMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => TradingModeInput.parse(d))
  .handler(async ({ data, context }) => {
    if (data.trading_mode === "live") {
      const { data: conn } = await context.supabase
        .from("broker_connections")
        .select("id, status")
        .eq("user_id", context.userId)
        .eq("is_default", true)
        .maybeSingle();
      if (!conn) return { ok: false as const, reason: "Connect a broker and set a default execution account first." };
      if (conn.status !== "connected") {
        return { ok: false as const, reason: `Default broker connection is ${conn.status}. Reconnect it first.` };
      }
    }
    const { error } = await context.supabase
      .from("user_settings")
      .update({
        trading_mode: data.trading_mode,
        live_trading_enabled: data.trading_mode === "live",
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

