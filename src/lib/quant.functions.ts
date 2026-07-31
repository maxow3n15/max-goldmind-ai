import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { QuantIntel } from "./services/quant.types";
import type { Direction } from "./services/types";

const Input = z.object({
  timeframe: z.string().default("15"),
  direction: z.enum(["BUY", "SELL"]).nullable().optional(),
});

/**
 * Volume, volatility, momentum, candle-quality and correlation intelligence.
 * Server-side so the OHLCV fetch is cached and shared across users.
 */
export const getQuantIntel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d ?? {}))
  .handler(async ({ data }): Promise<QuantIntel> => {
    const { buildQuantIntel } = await import("./quant.server");
    return buildQuantIntel(data.timeframe, (data.direction ?? null) as Direction | null);
  });
