import { describe, it, expect } from "vitest";
import {
  resolveConversion,
  validateConversion,
  identityConversion,
  isValidQuote,
  FX_MAX_AGE_MS,
  type FxQuote,
} from "@/lib/services/fx";
import {
  assessRisk,
  specProblem,
  isUsableSpec,
  roundVolumeToStep,
  DEFAULT_RISK_LIMITS,
  type RiskInput,
  type SymbolSpec,
} from "@/lib/services/risk-engine";

const NOW = 1_700_000_000_000;

const quote = (pair: string, bid: number, ask: number, ts = NOW): FxQuote => ({
  pair,
  bid,
  ask,
  timestamp: ts,
  source: "test-feed",
});

/** Fetcher backed by a fixed table of available pairs. */
const feed = (table: Record<string, FxQuote>) => async (pair: string) => table[pair] ?? null;

/* ------------------------------------------------------------------ */
/* FX resolution                                                       */
/* ------------------------------------------------------------------ */

describe("FX conversion resolution", () => {
  it("returns identity when instrument and account currency match (USD account)", async () => {
    const res = await resolveConversion({ from: "USD", to: "USD", fetchQuote: feed({}), now: NOW });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.conversion.rate).toBe(1);
      expect(res.conversion.direction).toBe("identity");
    }
  });

  it("uses the direct pair when the broker quotes it (USD_GBP)", async () => {
    const res = await resolveConversion({
      from: "USD",
      to: "GBP",
      fetchQuote: feed({ USD_GBP: quote("USD_GBP", 0.78, 0.7802) }),
      now: NOW,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.conversion.direction).toBe("direct");
      expect(res.conversion.rate).toBeCloseTo(0.7801, 6);
    }
  });

  it("inverts GBP_USD when USD_GBP is unavailable (GBP account + XAUUSD)", async () => {
    const res = await resolveConversion({
      from: "USD",
      to: "GBP",
      fetchQuote: feed({ GBP_USD: quote("GBP_USD", 1.2499, 1.2501) }),
      now: NOW,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.conversion.direction).toBe("inverse");
      expect(res.conversion.rate).toBeCloseTo(1 / 1.25, 6);
      expect(res.conversion.legs).toEqual(["GBP_USD"]);
    }
  });

  it("crosses through USD when neither direct nor inverse exists", async () => {
    const res = await resolveConversion({
      from: "JPY",
      to: "GBP",
      fetchQuote: feed({
        USD_JPY: quote("USD_JPY", 149.99, 150.01),
        GBP_USD: quote("GBP_USD", 1.2499, 1.2501),
      }),
      now: NOW,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.conversion.direction).toBe("cross");
      // JPY→USD = 1/150, USD→GBP = 1/1.25
      expect(res.conversion.rate).toBeCloseTo((1 / 150) * (1 / 1.25), 8);
    }
  });

  it("EUR account: converts USD instrument value into EUR", async () => {
    const res = await resolveConversion({
      from: "USD",
      to: "EUR",
      fetchQuote: feed({ EUR_USD: quote("EUR_USD", 1.0799, 1.0801) }),
      now: NOW,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.conversion.rate).toBeCloseTo(1 / 1.08, 6);
  });

  it("GBP account + GBPUSD instrument: quote currency USD still converts", async () => {
    const res = await resolveConversion({
      from: "USD",
      to: "GBP",
      fetchQuote: feed({ GBP_USD: quote("GBP_USD", 1.25, 1.25) }),
      now: NOW,
    });
    expect(res.ok).toBe(true);
  });

  it("blocks when no rate is available at all", async () => {
    const res = await resolveConversion({ from: "USD", to: "GBP", fetchQuote: feed({}), now: NOW });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/Unable to safely convert USD .* GBP/);
  });

  it("rejects stale quotes rather than using them", async () => {
    const res = await resolveConversion({
      from: "USD",
      to: "GBP",
      fetchQuote: feed({ USD_GBP: quote("USD_GBP", 0.78, 0.78, NOW - FX_MAX_AGE_MS - 1) }),
      now: NOW,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/stale/);
  });

  it("rejects zero, negative, NaN and infinite quotes", async () => {
    for (const bad of [0, -1.2, NaN, Infinity]) {
      expect(isValidQuote(quote("USD_GBP", bad, bad))).toBe(false);
      const res = await resolveConversion({
        from: "USD",
        to: "GBP",
        fetchQuote: feed({ USD_GBP: quote("USD_GBP", bad, bad) }),
        now: NOW,
      });
      expect(res.ok).toBe(false);
    }
  });

  it("treats a throwing price source as unavailable and blocks", async () => {
    const res = await resolveConversion({
      from: "USD",
      to: "GBP",
      fetchQuote: async () => {
        throw new Error("broker disconnected");
      },
      now: NOW,
    });
    expect(res.ok).toBe(false);
  });
});

describe("conversion validation", () => {
  it("accepts identity forever and a fresh rate within the window", () => {
    expect(validateConversion(identityConversion("GBP"), NOW).ok).toBe(true);
    const c = {
      from: "USD",
      to: "GBP",
      rate: 0.8,
      source: "oanda",
      timestamp: NOW - 1000,
      direction: "direct" as const,
      legs: ["USD_GBP"],
    };
    expect(validateConversion(c, NOW).ok).toBe(true);
    expect(validateConversion({ ...c, timestamp: NOW - FX_MAX_AGE_MS - 1 }, NOW).ok).toBe(false);
    expect(validateConversion({ ...c, rate: 0 }, NOW).ok).toBe(false);
    expect(validateConversion({ ...c, rate: -1 }, NOW).ok).toBe(false);
    expect(validateConversion({ ...c, rate: NaN }, NOW).ok).toBe(false);
    expect(validateConversion({ ...c, rate: Infinity }, NOW).ok).toBe(false);
    expect(validateConversion(null, NOW).ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Sizing with a GBP account trading XAUUSD                            */
/* ------------------------------------------------------------------ */

const USD_GBP = 0.8; // 1 USD = 0.80 GBP

const gbpXauSpec = (over: Partial<SymbolSpec> = {}): SymbolSpec => ({
  symbol: "XAU_USD",
  contractSize: 100,
  tickSize: 0.01,
  // 0.01 × 100 = $1.00 per tick → converted into GBP.
  tickValue: 0.01 * 100 * USD_GBP,
  volumeMin: 0.01,
  volumeMax: 50,
  volumeStep: 0.01,
  marginRate: 0.05,
  quoteCurrency: "USD",
  accountCurrency: "GBP",
  conversion: {
    from: "USD",
    to: "GBP",
    rate: USD_GBP,
    source: "oanda-pricing",
    timestamp: NOW - 5_000,
    direction: "inverse",
    legs: ["GBP_USD"],
  },
  ...over,
});

const gbpInput = (over: Partial<RiskInput> = {}): RiskInput => ({
  now: NOW,
  limits: { ...DEFAULT_RISK_LIMITS, maxTotalExposureLots: 50 },
  balance: 10_000, // GBP
  equity: 10_000,
  peakEquity: 10_000,
  dailyPnl: 0,
  weeklyPnl: 0,
  openPositions: [],
  tradesToday: 0,
  consecutiveLosses: 0,
  lastLossAt: null,
  spread: 0.2,
  atr: 5,
  feedHealthy: true,
  proposal: { direction: "BUY", entry: 2400, stop_loss: 2390 },
  spec: gbpXauSpec(),
  ...over,
});

describe("GBP account trading XAUUSD", () => {
  it("sizes to the GBP risk budget through the USD→GBP conversion", () => {
    // Budget: 0.5% of £10,000 = £50.
    // Per lot: 10.00 USD move × 100 oz = $1,000 → £800.
    // 50 / 800 = 0.0625 lots → rounds down to 0.06 lots → £48 risk.
    const r = assessRisk(gbpInput());
    expect(r.allowed).toBe(true);
    expect(r.lotSize).toBeCloseTo(0.06, 6);
    expect(r.riskAmount).toBeCloseTo(48, 2);
    expect(r.actualRiskPct!).toBeLessThanOrEqual(0.5);
  });

  it("a USD account with identical numbers sizes differently (currency matters)", () => {
    const usd = assessRisk(
      gbpInput({
        spec: gbpXauSpec({
          accountCurrency: "USD",
          tickValue: 1,
          conversion: identityConversion("USD"),
        }),
      }),
    );
    // $50 budget / $1,000 per lot = 0.05 lots.
    expect(usd.lotSize).toBeCloseTo(0.05, 6);
  });

  it("never rounds up into an unacceptable risk level", () => {
    const r = assessRisk(gbpInput({ spec: gbpXauSpec({ volumeStep: 0.01 }) }));
    const perLot = 10 * 100 * USD_GBP; // GBP per lot at a 10.00 stop
    expect(r.lotSize! * perLot).toBeLessThanOrEqual((10_000 * 0.5) / 100 + 1e-9);
    expect(roundVolumeToStep(0.0625, gbpXauSpec())).toBeCloseTo(0.06, 6);
  });

  it("blocks when the rounded size would exceed the per-trade cap", () => {
    const r = assessRisk(
      gbpInput({
        limits: { ...DEFAULT_RISK_LIMITS, maxTotalExposureLots: 50, riskPerTradePct: 0.5, maxRiskPerTradePct: 0.5 },
        spec: gbpXauSpec({ volumeMin: 0.5, volumeStep: 0.5 }),
      }),
    );
    expect(r.allowed).toBe(false);
    expect(r.violations.map((v) => v.key)).toContain("min_volume");
  });

  it("blocks sizing when the FX conversion is stale", () => {
    const stale = gbpXauSpec({
      conversion: { ...gbpXauSpec().conversion, timestamp: NOW - FX_MAX_AGE_MS - 1 },
    });
    expect(isUsableSpec(stale, NOW)).toBe(false);
    expect(specProblem(stale, NOW)).toMatch(/stale/);
    const r = assessRisk(gbpInput({ spec: stale }));
    expect(r.allowed).toBe(false);
    expect(r.violations.map((v) => v.key)).toContain("symbol_spec");
  });

  it("blocks sizing when the conversion is missing, zero or mismatched", () => {
    const missing = { ...gbpXauSpec(), conversion: undefined } as unknown as SymbolSpec;
    expect(specProblem(missing, NOW)).toMatch(/FX conversion/);

    const zero = gbpXauSpec({ conversion: { ...gbpXauSpec().conversion, rate: 0 } });
    expect(specProblem(zero, NOW)).toMatch(/zero or negative/);

    const mismatched = gbpXauSpec({
      conversion: { ...gbpXauSpec().conversion, to: "EUR" },
    });
    expect(specProblem(mismatched, NOW)).toMatch(/does not match/);
  });

  it("blocks on invalid contract size, tick size or volume increment", () => {
    expect(specProblem(gbpXauSpec({ contractSize: 0 }), NOW)).toMatch(/contract size/);
    expect(specProblem(gbpXauSpec({ tickSize: 0 }), NOW)).toMatch(/tick size/);
    expect(specProblem(gbpXauSpec({ volumeStep: 0 }), NOW)).toMatch(/volume step/);
    expect(specProblem(null, NOW)).toMatch(/no broker symbol specification/);
    const r = assessRisk(gbpInput({ spec: null }));
    expect(r.allowed).toBe(false);
    expect(r.lotSize).toBeNull();
  });
});
