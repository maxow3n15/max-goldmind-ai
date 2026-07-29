import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const UpdateStopInput = z.object({
  id: z.string().uuid(),
  stop_loss: z.number().positive(),
});

export const updateTradeStop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UpdateStopInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("trades")
      .update({ stop_loss: data.stop_loss })
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .eq("status", "open");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Convenience: return the most recent closed trades in order, so the
// engine can compute consecutive-loss streaks without pulling everything.
export const recentClosedTrades = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("trades")
      .select("id, pnl, closed_at, opened_at, status")
      .eq("user_id", context.userId)
      .eq("status", "closed")
      .order("closed_at", { ascending: false })
      .limit(20);
    return data ?? [];
  });
