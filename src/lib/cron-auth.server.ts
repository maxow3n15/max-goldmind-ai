// Scheduler authentication.
//
// The tick endpoint is called by pg_cron, which has no user session, so it
// authenticates with a shared secret. The secret used to be a literal inside a
// committed migration AND inside the scheduled job's command text; it is now
// held only in managed secret storage and verified through a security-definer
// function that no client role may execute.
//
// Nothing in this module reads, returns or logs the secret value itself: it
// returns a boolean and nothing else.

export type CronAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

/**
 * Verifies the `x-cron-secret` header against the rotating secret held in
 * managed storage. Fails closed on every error path — an unverifiable caller
 * never runs a trading tick.
 */
export async function verifyCronRequest(request: Request): Promise<CronAuthResult> {
  const provided = request.headers.get("x-cron-secret");
  if (!provided) return { ok: false, status: 401, error: "unauthorised" };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("verify_cron_secret" as never, {
    _provided: provided,
  } as never);

  if (error) {
    // Distinguish "not configured yet" from "wrong secret" for the operator,
    // without telling an unauthenticated caller anything useful.
    console.error("cron secret verification failed", error.message);
    return { ok: false, status: 503, error: "scheduler auth unavailable" };
  }
  if (data !== true) return { ok: false, status: 401, error: "unauthorised" };
  return { ok: true };
}
