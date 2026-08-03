import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildForensics, type ForensicTrade } from "@/lib/services/forensics";
import { buildCalibration } from "@/lib/services/calibration";

const ExcursionRow = z.object({
  id: z.string().uuid(),
  mae: z.number().min(0),
  mfe: z.number().min(0),
  mae_r: z.number().min(0),
  mfe_r: z.number().min(0),
});

const RecordInput = z.object({ rows: z.array(ExcursionRow).min(1).max(50) });

/**
 * Persist the running adverse/favourable excursions of open trades. Called
 * on a throttle by the engine — only when the numbers have actually moved.
 */
export const recordExcursions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RecordInput.parse(d))
  .handler(async ({ data, context }) => {
    const stamp = new Date().toISOString();
    let updated = 0;
    for (const r of data.rows) {
      const { error } = await context.supabase
        .from("trades")
        .update({ mae: r.mae, mfe: r.mfe, mae_r: r.mae_r, mfe_r: r.mfe_r, excursion_updated_at: stamp })
        .eq("id", r.id)
        .eq("user_id", context.userId)
        .eq("status", "open");
      if (!error) updated += 1;
    }
    return { updated };
  });

/**
 * Trade forensics plus confidence calibration over the closed history.
 * Both are pure statistics over stored outcomes.
 */
export const getForensics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("trades")
      .select("id, direction, entry_price, stop_loss, exit_price, pnl, mae_r, mfe_r, risk_reward, confidence, session, reason_exit, opened_at, closed_at")
      .eq("user_id", context.userId)
      .eq("status", "closed")
      .order("closed_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as unknown as ForensicTrade[];
    return {
      forensics: buildForensics(rows),
      calibration: buildCalibration(rows.map((t) => ({ confidence: t.confidence, pnl: t.pnl }))),
      excursion_coverage: rows.length
        ? Math.round((rows.filter((t) => t.mfe_r != null).length / rows.length) * 100)
        : 0,
    };
  });
