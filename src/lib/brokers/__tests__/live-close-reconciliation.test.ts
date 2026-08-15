import { describe, expect, it, vi, beforeEach } from "vitest";

// Broker + crypto are dynamically imported inside the core, so they can be
// mocked wholesale here without touching production wiring.
const closePosition = vi.fn();
const modifyPosition = vi.fn();
const positionExists = vi.fn();

vi.mock("@/lib/brokers/connectors.server", () => ({
  getConnector: () => ({
    id: "metaapi",
    closePosition,
    modifyPosition,
    positionExists,
    fetchAccount: vi.fn(),
    placeOrder: vi.fn(),
  }),
}));

vi.mock("@/lib/brokers/crypto.server", () => ({
  decryptCredentials: () => ({ accountId: "acc", token: "t" }),
}));

const TRADE = {
  id: "trade-1",
  user_id: "user-1",
  direction: "BUY",
  entry_price: 2400,
  lot_size: 0.1,
  status: "open",
  ai_analysis: {
    broker_order_id: "pos-1",
    broker_id: "metaapi",
    symbol_spec: { tickSize: 0.01, tickValue: 1 },
  },
};

/** Minimal chainable Supabase stub that records trade updates. */
function makeSupabase() {
  const updates: any[] = [];
  const supabase = {
    updates,
    from(table: string) {
      const chain: any = {
        _table: table,
        _update: null as any,
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () =>
          table === "broker_connections"
            ? { data: { id: "c1", broker_id: "metaapi", credentials_ciphertext: "x" } }
            : { data: null },
        single: async () => (table === "trades" ? { data: TRADE } : { data: null }),
        update(payload: any) {
          chain._update = payload;
          updates.push({ table, payload });
          return chain;
        },
        then: (resolve: any) => resolve({ error: null }),
      };
      return chain;
    },
  };
  return supabase as any;
}

describe("live close/modify confirmation", () => {
  beforeEach(() => {
    closePosition.mockReset();
    modifyPosition.mockReset();
    positionExists.mockReset();
  });

  it("does not mark the trade closed when the broker close throws", async () => {
    const { closeLiveOrderCore, RECONCILIATION_REQUIRED } = await import("../live-execution.server");
    closePosition.mockRejectedValue(new Error("broker 500"));
    positionExists.mockResolvedValue(true); // still open at the broker

    const supabase = makeSupabase();
    await expect(closeLiveOrderCore(supabase, "user-1", { id: "trade-1", exit_price: 2410 })).rejects.toThrow(
      /not confirmed/i,
    );

    const statuses = supabase.updates.map((u: any) => u.payload.status);
    expect(statuses).toContain(RECONCILIATION_REQUIRED);
    expect(statuses).not.toContain("closed");
  });

  it("fails closed when the broker still reports the position open after a 'successful' close", async () => {
    const { closeLiveOrderCore, RECONCILIATION_REQUIRED } = await import("../live-execution.server");
    closePosition.mockResolvedValue(undefined);
    positionExists.mockResolvedValue(true);

    const supabase = makeSupabase();
    await expect(
      closeLiveOrderCore(supabase, "user-1", { id: "trade-1", exit_price: 2410 }),
    ).rejects.toThrow(/not confirmed/i);
    expect(supabase.updates.map((u: any) => u.payload.status)).toContain(RECONCILIATION_REQUIRED);
  });

  it("closes normally when the broker confirms the position is gone", async () => {
    const { closeLiveOrderCore } = await import("../live-execution.server");
    closePosition.mockResolvedValue(undefined);
    positionExists.mockResolvedValue(false);

    const supabase = makeSupabase();
    const res = await closeLiveOrderCore(supabase, "user-1", { id: "trade-1", exit_price: 2410 });
    expect(res.pnl).toBeCloseTo(10 * 100 * 0.1, 6);
    expect(supabase.updates.map((u: any) => u.payload.status)).toContain("closed");
  });

  it("flags reconciliation when a stop modification fails", async () => {
    const { modifyLiveOrderCore, RECONCILIATION_REQUIRED } = await import("../live-execution.server");
    modifyPosition.mockRejectedValue(new Error("rejected"));

    const supabase = makeSupabase();
    await expect(
      modifyLiveOrderCore(supabase, "user-1", { id: "trade-1", stop_loss: 2395 }),
    ).rejects.toThrow(/not confirmed/i);
    const statuses = supabase.updates.map((u: any) => u.payload.status);
    expect(statuses).toContain(RECONCILIATION_REQUIRED);
    expect(supabase.updates.some((u: any) => u.payload.stop_loss === 2395)).toBe(false);
  });
});
