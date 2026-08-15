import { describe, expect, it, vi } from "vitest";

const positionExists = vi.fn();

vi.mock("@/lib/brokers/connectors.server", () => ({
  getConnector: () => ({ id: "metaapi", positionExists }),
}));
vi.mock("@/lib/brokers/crypto.server", () => ({
  decryptCredentials: () => ({ accountId: "acc" }),
}));

function makeSupabase(trades: any[]) {
  const updates: any[] = [];
  return {
    updates,
    from(table: string) {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        in: async () => ({ data: table === "trades" ? trades : [] }),
        maybeSingle: async () =>
          table === "broker_connections"
            ? { data: { broker_id: "metaapi", credentials_ciphertext: "x" } }
            : { data: null },
        update(payload: any) {
          updates.push(payload);
          return chain;
        },
        then: (resolve: any) => resolve({ error: null }),
      };
      return chain;
    },
  } as any;
}

const openTrade = (over: any = {}) => ({
  id: "t1",
  status: "open",
  mode: "live",
  ai_analysis: { broker_id: "metaapi", broker_order_id: "pos-1" },
  ...over,
});

describe("broker/database reconciliation", () => {
  it("flags a trade the broker no longer has open", async () => {
    const { reconcileUserPositions } = await import("../reconciliation.server");
    const { RECONCILIATION_REQUIRED } = await import("@/lib/brokers/live-execution.server");
    positionExists.mockResolvedValue(false);

    const supabase = makeSupabase([openTrade()]);
    const report = await reconcileUserPositions(supabase, "user-1");

    expect(report.mismatches[0]?.kind).toBe("missing_at_broker");
    expect(report.flagged).toBe(1);
    expect(supabase.updates[0].status).toBe(RECONCILIATION_REQUIRED);
  });

  it("reports no mismatch when broker and database agree", async () => {
    const { reconcileUserPositions } = await import("../reconciliation.server");
    positionExists.mockResolvedValue(true);

    const supabase = makeSupabase([openTrade()]);
    const report = await reconcileUserPositions(supabase, "user-1");
    expect(report.mismatches).toHaveLength(0);
    expect(supabase.updates).toHaveLength(0);
  });

  it("treats an unverifiable broker read as a mismatch", async () => {
    const { reconcileUserPositions } = await import("../reconciliation.server");
    positionExists.mockRejectedValue(new Error("broker timeout"));

    const supabase = makeSupabase([openTrade()]);
    const report = await reconcileUserPositions(supabase, "user-1");
    expect(report.mismatches[0]?.kind).toBe("unverifiable");
  });

  it("keeps surfacing an already-flagged trade that is still open at the broker", async () => {
    const { reconcileUserPositions } = await import("../reconciliation.server");
    const { RECONCILIATION_REQUIRED } = await import("@/lib/brokers/live-execution.server");
    positionExists.mockResolvedValue(true);

    const supabase = makeSupabase([openTrade({ status: RECONCILIATION_REQUIRED })]);
    const report = await reconcileUserPositions(supabase, "user-1");
    expect(report.mismatches[0]?.kind).toBe("still_flagged");
    expect(supabase.updates).toHaveLength(0);
  });
});
