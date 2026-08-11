import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface AiHealthBucket {
  source: string;
  calls: number;
  ok: number;
  timeouts: number;
  rateLimits: number;
  upstreamErrors: number;
  emptyResponses: number;
  parseErrors: number;
  validationRejects: number;
  noPrice: number;
  errors: number;
  retries: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
}

export interface AiHealthSummary {
  windowHours: number;
  total: AiHealthBucket;
  bySource: AiHealthBucket[];
  topRejections: { reason: string; count: number }[];
  recent: {
    id: string;
    source: string;
    status: string;
    model: string | null;
    latency_ms: number | null;
    attempts: number;
    error: string | null;
    created_at: string;
  }[];
  lastOkAt: string | null;
  lastFailureAt: string | null;
}

function emptyBucket(source: string): AiHealthBucket {
  return {
    source, calls: 0, ok: 0, timeouts: 0, rateLimits: 0, upstreamErrors: 0,
    emptyResponses: 0, parseErrors: 0, validationRejects: 0, noPrice: 0,
    errors: 0, retries: 0, avgLatencyMs: null, p95LatencyMs: null,
  };
}

function finalise(bucket: AiHealthBucket, latencies: number[]): AiHealthBucket {
  if (latencies.length === 0) return bucket;
  const sorted = [...latencies].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return {
    ...bucket,
    avgLatencyMs: Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length),
    p95LatencyMs: Math.round(sorted[idx]!),
  };
}

export const getAiHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AiHealthSummary> => {
    const windowHours = 24;
    const since = new Date(Date.now() - windowHours * 3600_000).toISOString();

    const { data } = await context.supabase
      .from("ai_health_events")
      .select("*")
      .eq("user_id", context.userId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500);

    const rows = data ?? [];
    const total = emptyBucket("all");
    const totalLat: number[] = [];
    const perSource = new Map<string, { b: AiHealthBucket; lat: number[] }>();
    const rejections = new Map<string, number>();
    let lastOkAt: string | null = null;
    let lastFailureAt: string | null = null;

    for (const r of rows as any[]) {
      const src = String(r.source ?? "unknown");
      if (!perSource.has(src)) perSource.set(src, { b: emptyBucket(src), lat: [] });
      const entry = perSource.get(src)!;
      for (const b of [total, entry.b]) {
        b.calls += 1;
        b.timeouts += r.timeouts ?? 0;
        b.rateLimits += r.rate_limits ?? 0;
        b.upstreamErrors += r.upstream_errors ?? 0;
        b.emptyResponses += r.empty_responses ?? 0;
        b.parseErrors += r.parse_errors ?? 0;
        b.validationRejects += r.validation_rejects ?? 0;
        b.retries += Math.max(0, (r.attempts ?? 1) - 1);
        if (r.status === "ok") b.ok += 1;
        if (r.status === "no_price") b.noPrice += 1;
        if (r.status === "error") b.errors += 1;
      }
      if (typeof r.latency_ms === "number") {
        totalLat.push(r.latency_ms);
        entry.lat.push(r.latency_ms);
      }
      for (const reason of (Array.isArray(r.rejection_reasons) ? r.rejection_reasons : [])) {
        const key = String(reason).slice(0, 140);
        rejections.set(key, (rejections.get(key) ?? 0) + 1);
      }
      if (r.status === "ok") { if (!lastOkAt) lastOkAt = r.created_at; }
      else if (!lastFailureAt) lastFailureAt = r.created_at;
    }

    return {
      windowHours,
      total: finalise(total, totalLat),
      bySource: [...perSource.values()]
        .map(({ b, lat }) => finalise(b, lat))
        .sort((a, b) => b.calls - a.calls),
      topRejections: [...rejections.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6),
      recent: (rows as any[]).slice(0, 20).map((r) => ({
        id: r.id,
        source: r.source,
        status: r.status,
        model: r.model ?? null,
        latency_ms: r.latency_ms ?? null,
        attempts: r.attempts ?? 1,
        error: r.error ?? null,
        created_at: r.created_at,
      })),
      lastOkAt,
      lastFailureAt,
    };
  });
