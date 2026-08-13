import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Multi-timeframe structural read for the browser engine.
 *
 * The client used to run without an MTF report at all, which meant the
 * timeframe-agreement gate could never pass and the browser engine could never
 * open a trade. This exposes the same server-built bundle the cron tick uses,
 * so both paths reason about identical structure.
 */
export const getMarketStructure = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ timeframe: z.string().max(8).default("15") }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const { buildMarketStructure } = await import("@/lib/mtf.server");
    const bundle = await buildMarketStructure(data.timeframe);
    return {
      generated_at: bundle.generated_at,
      mtf: bundle.mtf,
      entryStructure: bundle.entryStructure,
      levels: bundle.levels,
      lastCandleAt: bundle.lastCandleAt,
      candleAgeMs: bundle.candleAgeMs,
      degraded: bundle.degraded,
      integrity: bundle.integrity,
    };
  });
