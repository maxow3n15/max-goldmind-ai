import { describe, expect, it } from "vitest";
import { classifySetup } from "../setup-models";
import type { StructureRead } from "../structure";

const now = Date.UTC(2026, 1, 10, 14, 0, 0);

function structure(over: Partial<StructureRead> = {}): StructureRead {
  return {
    bias: "bullish",
    events: [{ type: "CHOCH", direction: "bullish", t: now - 60_000, price: 2000 }],
    sweeps: [{ side: "sell_side", price: 1990, t: now - 120_000, reclaimed: true }],
    fvgs: [{ direction: "bullish", top: 2002, bottom: 1998, t: now - 90_000, mitigated: false }],
    orderBlocks: [],
    breakers: [],
    premiumDiscount: "discount",
    rangePosition: 0.3,
    displacement: true,
    atr: 4,
    ...(over as Record<string, unknown>),
  } as unknown as StructureRead;
}

const proposal = { direction: "BUY" as const, entry: 2000, stop_loss: 1988, take_profit_1: 2030 };

describe("setup recognition", () => {
  it("names a complete liquidity sweep reversal", () => {
    const c = classifySetup({ proposal, entryStructure: structure(), mtf: null, now });
    expect(c.best?.type).toBe("LIQUIDITY_SWEEP_REVERSAL");
    expect(c.best?.verdict).toBe("VALID");
    expect(c.tradable).toBe(true);
  });

  it("refuses a proposal with no reclaimed sweep and no trend backing", () => {
    const c = classifySetup({
      proposal,
      entryStructure: structure({ sweeps: [], events: [], fvgs: [], displacement: false } as never),
      mtf: null,
      now,
    });
    expect(c.tradable).toBe(false);
    expect(c.reason).toMatch(/No complete setup model|No setup model/);
  });

  it("refuses when structure is unavailable", () => {
    const c = classifySetup({ proposal, entryStructure: null, mtf: null, now });
    expect(c.tradable).toBe(false);
    expect(c.reason).toMatch(/structure/i);
  });

  it("ignores stale structural events outside the recency window", () => {
    const stale = structure({
      events: [{ type: "CHOCH", direction: "bullish", t: now - 48 * 3600_000, price: 2000 }],
    } as never);
    const c = classifySetup({ proposal, entryStructure: stale, mtf: null, now });
    expect(c.best?.requirements.find((r) => r.key === "flip")?.met).toBe(false);
    expect(c.tradable).toBe(false);
  });

  it("does not name a buy off a sell-side setup direction mismatch", () => {
    const c = classifySetup({
      proposal: { ...proposal, direction: "SELL" },
      entryStructure: structure(),
      mtf: null,
      now,
    });
    expect(c.tradable).toBe(false);
  });
});
