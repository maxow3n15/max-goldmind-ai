// Distributed advisory lock backed by the system_locks table.
//
// The scheduled tick can be invoked by pg_cron, a manual curl, or a retry of a
// slow request. Without a lock two overlapping invocations would both read the
// same open positions and both act on them. Acquisition is atomic in Postgres
// (INSERT ... ON CONFLICT DO UPDATE WHERE locked_until < now()), so exactly one
// caller wins even under true concurrency.

export interface LockHandle {
  key: string;
  holder: string;
  release: () => Promise<void>;
}

/**
 * Try to take `key` for `ttlSeconds`. Returns null when another invocation
 * already holds it. The TTL is a dead-man's switch: a crashed holder's lock
 * expires on its own rather than wedging the scheduler forever.
 */
export async function acquireLock(
  supabase: any,
  key: string,
  ttlSeconds: number,
): Promise<LockHandle | null> {
  const holder = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const { data, error } = await supabase.rpc("try_acquire_lock", {
    _key: key,
    _ttl_seconds: ttlSeconds,
    _holder: holder,
  });
  if (error) {
    // Fail closed: if we cannot prove we hold the lock, we do not run.
    console.error(`[lock] could not acquire "${key}":`, error.message);
    return null;
  }
  if (data !== true) return null;
  return {
    key,
    holder,
    release: async () => {
      const { error: relError } = await supabase.rpc("release_lock", { _key: key, _holder: holder });
      if (relError) console.error(`[lock] could not release "${key}":`, relError.message);
    },
  };
}
