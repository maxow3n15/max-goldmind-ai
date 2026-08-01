import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const DecisionSchema = z.object({
  cycleId: z.string(),
  ts: z.number(),
  symbol: z.string().default("XAUUSD"),
  timeframe: z.string(),
  outcome: z.enum(["accepted", "rejected", "error"]),
  direction: z.enum(["BUY", "SELL"]).nullable(),
  confidence: z.number().nullable(),
  technicalScore: z.number().nullable(),
  newsScore: z.number().nullable(),
  reasoning: z.array(z.string()).max(60).default([]),
  blockers: z.array(z.string()).max(60).default([]),
  price: z.number().nullable(),
  spread: z.number().nullable(),
  latency: z.record(z.string(), z.number()).default({}),
  payload: z.record(z.string(), z.unknown()).default({}),
});

const RecordInput = z.object({ decisions: z.array(DecisionSchema).min(1).max(50) });
const ListInput = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  outcome: z.enum(["accepted", "rejected", "error"]).nullable().default(null),
});

/** Persist a batch of AI decisions to the audit trail. */
export const recordDecisions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RecordInput.parse(d))
  .handler(async ({ data, context }) => {
    const rows = data.decisions.map((d) => ({
      user_id: context.userId,
      cycle_id: d.cycleId,
      decided_at: new Date(d.ts).toISOString(),
      symbol: d.symbol,
      timeframe: d.timeframe,
      outcome: d.outcome,
      direction: d.direction,
      confidence: d.confidence,
      technical_score: d.technicalScore,
      news_score: d.newsScore,
      reasoning: d.reasoning,
      blockers: d.blockers,
      price: d.price,
      spread: d.spread,
      latency: d.latency as Record<string, number>,
      payload: d.payload as Record<string, never>,

    }));

    const { error } = await context.supabase
      .from("decision_logs")
      .upsert(rows, { onConflict: "user_id,cycle_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    return { persisted: rows.length };
  });

/** Read the audit trail back for analytics and diagnostics. */
export const listDecisions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ListInput.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("decision_logs")
      .select("*")
      .order("decided_at", { ascending: false })
      .limit(data.limit);
    if (data.outcome) query = query.eq("outcome", data.outcome);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
