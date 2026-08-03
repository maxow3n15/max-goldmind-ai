import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BeatInput = z.object({
  engine: z.string().min(1).max(64),
  status: z.enum(["ok", "degraded", "down"]).default("ok"),
  detail: z.record(z.string(), z.unknown()).default({}),
});

/**
 * Server-side liveness. The browser engine reports in on a slow interval so
 * that "is the system actually running?" is answered by durable state
 * rather than by whatever the current tab happens to believe.
 */
export const recordHeartbeat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => BeatInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("engine_heartbeats")
      .upsert(
        {
          user_id: context.userId,
          engine: data.engine,
          status: data.status,
          detail: data.detail as Record<string, never>,
          last_beat_at: new Date().toISOString(),
        },
        { onConflict: "user_id,engine" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Read every engine's last check-in, with staleness computed server-side. */
export const listHeartbeats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("engine_heartbeats")
      .select("*")
      .eq("user_id", context.userId)
      .order("engine");
    if (error) throw new Error(error.message);
    const now = Date.now();
    return (data ?? []).map((h) => {
      const ageMs = now - new Date(h.last_beat_at).getTime();
      return {
        engine: h.engine,
        status: h.status,
        detail: h.detail,
        last_beat_at: h.last_beat_at,
        age_seconds: Math.round(ageMs / 1000),
        stale: ageMs > 120_000,
      };
    });
  });
