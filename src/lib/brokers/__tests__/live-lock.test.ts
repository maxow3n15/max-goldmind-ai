import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/brokers/connectors.server", () => ({
  getConnector: () => ({
    id: "metaapi",
    fetchAccount: vi.fn(),
    fetchSymbolSpec: vi.fn().mockResolvedValue({
      symbol: "XAUUSD",
      contractSize: 100,
      tickSize: 0.01,
      tickValue: 1,
      volumeMin: 0.01,
      volumeMax: 100,
      volumeStep: 0.01,
      marginRate: 0.005,
      source: "metaapi",
    }),
    placeOrder: vi.fn().mockResolvedValue({ broker_order_id: "pos-1" }),
    closePosition: vi.fn(),
    modifyPosition: vi.fn(),
  }),
}));

vi.mock("@/lib/brokers/crypto.server", () => ({
  decryptCredentials: () => ({ accountId: "acc", token: "t" }),
}));

/** Fully valid account state: only the admin lock should stop this order. */
function makeSupabase() {
  const inserted: any[] = [];
  return {
    inserted,
    from(table: string) {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => {
          if (table === "user_settings") {
            return { data: { live_trading_enabled: true, trading_mode: "live", max_open_trades: 3 } };
          }
          if (table === "broker_connections") {
            return {
              data: {
                id: "c1",
                broker_id: "metaapi",
                status: "connected",
                credentials_ciphertext: "x",
                free_margin: 100000,
                is_default: true,
              },
            };
          }
          return { data: null };
        },
        single: async () => ({ data: { id: "t1" }, error: null }),
        insert: (payload: any) => {
          inserted.push(payload);
          return chain;
        },
        update: () => chain,
        then: (resolve: any) => resolve({ data: [], error: null }),
      };
      return chain;
    },
  } as any;
}

describe("administrative live-execution lock", () => {
  const original = process.env["LIVE_TRADING_UNLOCK"];
  beforeEach(() => {
    delete process.env["LIVE_TRADING_UNLOCK"];
  });
  afterEach(() => {
    if (original === undefined) delete process.env["LIVE_TRADING_UNLOCK"];
    else process.env["LIVE_TRADING_UNLOCK"] = original;
  });

  it("defaults to locked when the env var is absent", async () => {
    const { getLiveExecutionLock } = await import("@/lib/live-lock.server");
    expect(getLiveExecutionLock().locked).toBe(true);
  });

  it("stays locked for any value other than the exact unlock token", async () => {
    const { getLiveExecutionLock } = await import("@/lib/live-lock.server");
    for (const v of ["true", "1", "yes", "unlock", ""]) {
      process.env["LIVE_TRADING_UNLOCK"] = v;
      expect(getLiveExecutionLock().locked).toBe(true);
    }
  });

  it("refuses placeLiveOrderCore even with valid credentials and a connected broker", async () => {
    const { placeLiveOrderCore } = await import("../live-execution.server");
    const supabase = makeSupabase();
    const res = await placeLiveOrderCore(supabase, "user-1", {
      direction: "BUY",
      entry_price: 2400,
      stop_loss: 2390,
      take_profit_1: 2420,
      lot_size: 0.1,
      spread: 0.2,
    });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toMatch(/administratively locked/i);
    expect(supabase.inserted).toHaveLength(0);
  });

  it("unlocks only with the exact token", async () => {
    process.env["LIVE_TRADING_UNLOCK"] = "UNLOCK_LIVE_TRADING";
    const { getLiveExecutionLock } = await import("@/lib/live-lock.server");
    expect(getLiveExecutionLock().locked).toBe(false);
  });
});
