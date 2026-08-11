// Server-only AI health telemetry.
//
// Every AI gateway call records one row: how long it took, how many attempts
// it burned, and which failure classes it hit (timeout, 429, upstream 5xx,
// empty body, unparseable JSON, rejected setup). Efficiency problems in the
// analysis path are otherwise invisible — the UI just shows "no setup".

export type AiCallStatus =
  | "ok"
  | "timeout"
  | "rate_limited"
  | "upstream_error"
  | "empty_response"
  | "parse_error"
  | "validation_reject"
  | "no_price"
  | "error";

export interface AiTelemetry {
  attempts: number;
  timeouts: number;
  rateLimits: number;
  upstreamErrors: number;
  emptyResponses: number;
  parseErrors: number;
  validationRejects: number;
  rejectionReasons: string[];
  model: string | null;
  httpStatus: number | null;
  startedAt: number;
}

export function newTelemetry(): AiTelemetry {
  return {
    attempts: 0,
    timeouts: 0,
    rateLimits: 0,
    upstreamErrors: 0,
    emptyResponses: 0,
    parseErrors: 0,
    validationRejects: 0,
    rejectionReasons: [],
    model: null,
    httpStatus: null,
    startedAt: Date.now(),
  };
}

export async function recordAiHealth(opts: {
  userId?: string | null;
  source: string;
  status: AiCallStatus;
  telemetry: AiTelemetry;
  error?: string | null;
}): Promise<void> {
  if (!opts.userId) return;
  const t = opts.telemetry;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("ai_health_events").insert({
      user_id: opts.userId,
      source: opts.source,
      model: t.model,
      status: opts.status,
      attempts: Math.max(1, t.attempts),
      timeouts: t.timeouts,
      rate_limits: t.rateLimits,
      upstream_errors: t.upstreamErrors,
      empty_responses: t.emptyResponses,
      parse_errors: t.parseErrors,
      validation_rejects: t.validationRejects,
      rejection_reasons: t.rejectionReasons.slice(0, 5),
      latency_ms: Math.round(Date.now() - t.startedAt),
      http_status: t.httpStatus,
      error: opts.error ? String(opts.error).slice(0, 300) : null,
    });
  } catch (e) {
    // Telemetry must never break a trading decision.
    console.error("ai health record failed", e);
  }
}
