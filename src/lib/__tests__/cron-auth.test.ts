// The scheduler endpoint must fail closed on every path that is not a
// positively verified secret.

import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import { verifyCronRequest } from "@/lib/cron-auth.server";

const req = (headers: Record<string, string> = {}) =>
  new Request("https://example.test/api/public/cron/tick", { method: "POST", headers });

describe("verifyCronRequest", () => {
  beforeEach(() => rpc.mockReset());

  it("rejects a request with no secret header without touching the database", async () => {
    const res = await verifyCronRequest(req());
    expect(res).toEqual({ ok: false, status: 401, error: "unauthorised" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects an empty secret header", async () => {
    const res = await verifyCronRequest(req({ "x-cron-secret": "" }));
    expect(res.ok).toBe(false);
  });

  it("rejects when the database says the secret does not match", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const res = await verifyCronRequest(req({ "x-cron-secret": "wrong" }));
    expect(res).toEqual({ ok: false, status: 401, error: "unauthorised" });
  });

  it("fails closed with 503 when verification itself errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await verifyCronRequest(req({ "x-cron-secret": "anything" }));
    expect(res).toEqual({ ok: false, status: 503, error: "scheduler auth unavailable" });
  });

  it("never treats a non-boolean-true response as authorised", async () => {
    for (const data of [null, undefined, "true", 1, {}]) {
      rpc.mockResolvedValue({ data, error: null });
      expect((await verifyCronRequest(req({ "x-cron-secret": "x" }))).ok).toBe(false);
    }
  });

  it("accepts only an explicit true", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await verifyCronRequest(req({ "x-cron-secret": "correct" }))).toEqual({ ok: true });
  });

  it("passes the header through under the validator's parameter name", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await verifyCronRequest(req({ "x-cron-secret": "abc" }));
    expect(rpc).toHaveBeenCalledWith("verify_cron_secret", { _provided: "abc" });
  });
});
