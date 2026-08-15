import { describe, expect, it } from "vitest";
import { acquireLock } from "../lock.server";

/**
 * Stub of the Postgres function: INSERT ... ON CONFLICT DO UPDATE WHERE
 * locked_until < now(). Serialised in JS the same way Postgres serialises the
 * row write, so two concurrent callers cannot both win.
 */
function makeLockingSupabase() {
  const rows = new Map<string, { holder: string; until: number }>();
  return {
    rows,
    async rpc(fn: string, args: any) {
      if (fn === "try_acquire_lock") {
        // Yield, to prove the result does not depend on interleaving.
        await Promise.resolve();
        const existing = rows.get(args._key);
        if (existing && existing.until > Date.now()) return { data: false, error: null };
        rows.set(args._key, { holder: args._holder, until: Date.now() + args._ttl_seconds * 1000 });
        return { data: true, error: null };
      }
      if (fn === "release_lock") {
        const existing = rows.get(args._key);
        if (existing?.holder === args._holder) rows.delete(args._key);
        return { data: null, error: null };
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
  } as any;
}

describe("scheduled tick concurrency lock", () => {
  it("lets only one of two concurrent invocations proceed", async () => {
    const supabase = makeLockingSupabase();
    const [a, b] = await Promise.all([
      acquireLock(supabase, "scheduled_tick", 120),
      acquireLock(supabase, "scheduled_tick", 120),
    ]);
    const winners = [a, b].filter(Boolean);
    expect(winners).toHaveLength(1);
  });

  it("allows the next invocation once the holder releases", async () => {
    const supabase = makeLockingSupabase();
    const first = await acquireLock(supabase, "scheduled_tick", 120);
    expect(first).not.toBeNull();
    expect(await acquireLock(supabase, "scheduled_tick", 120)).toBeNull();
    await first!.release();
    expect(await acquireLock(supabase, "scheduled_tick", 120)).not.toBeNull();
  });

  it("fails closed when the lock RPC errors", async () => {
    const broken = { rpc: async () => ({ data: null, error: { message: "db down" } }) } as any;
    expect(await acquireLock(broken, "scheduled_tick", 120)).toBeNull();
  });

  it("does not release a lock held by someone else", async () => {
    const supabase = makeLockingSupabase();
    const held = await acquireLock(supabase, "scheduled_tick", 120);
    await supabase.rpc("release_lock", { _key: "scheduled_tick", _holder: "someone-else" });
    expect(supabase.rows.get("scheduled_tick")?.holder).toBe(held!.holder);
  });
});
