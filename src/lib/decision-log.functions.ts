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
  /** Market-environment reading for this cycle (see services/environment.ts). */
  environment: z.string().max(200).nullable().default(null),
  environmentConfidence: z.number().min(0).max(100).nullable().default(null),
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
      environment: d.environment,
      environment_confidence: d.environmentConfidence,
    }));

    const { error } = await context.supabase
      .from("decision_logs")
      .upsert(rows, { onConflict: "user_id,cycle_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    return { persisted: rows.length };
  });

export interface ConfidenceCeilingCycle {
  cycleId: string;
  decidedAt: string;
  confidence: number;
  outcome: string;
  factors: {
    key: string;
    verdict: "pass" | "partial" | "fail" | "unavailable";
    points: number;
    weight: number;
    ratio: number;
    detail: string;
  }[] | null;
}

/**
 * The 10 highest-confidence cycles from the last 30 days, with their
 * structured confidence-factor verdicts (when the cycle recorded them).
 * Powers the "Confidence ceiling" heatmap on the diagnostics page.
 */
export const listConfidenceCeiling = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ConfidenceCeilingCycle[]> => {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await context.supabase
      .from("decision_logs")
      .select("cycle_id, decided_at, confidence, outcome, payload")
      .gte("decided_at", since)
      .not("confidence", "is", null)
      .order("confidence", { ascending: false })
      .limit(10);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      const raw = payload.structured_factors;
      const factors = Array.isArray(raw)
        ? raw
            .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null)
            .map((f) => ({
              key: String(f.key ?? ""),
              verdict: (["pass", "partial", "fail", "unavailable"].includes(String(f.verdict))
                ? String(f.verdict)
                : "unavailable") as "pass" | "partial" | "fail" | "unavailable",
              points: Number(f.points ?? 0),
              weight: Number(f.weight ?? 0),
              ratio: Number(f.ratio ?? 0),
              detail: String(f.detail ?? ""),
            }))
        : null;
      return {
        cycleId: String(row.cycle_id),
        decidedAt: String(row.decided_at),
        confidence: Number(row.confidence ?? 0),
        outcome: String(row.outcome),
        factors: factors && factors.length > 0 ? factors : null,
      };
    });
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
