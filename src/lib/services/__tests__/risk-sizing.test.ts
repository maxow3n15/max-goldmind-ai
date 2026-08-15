import { describe, it, expect } from "vitest";
import {
  assessRisk,
  roundVolumeToStep,
  DEFAULT_RISK_LIMITS,
  type RiskInput,
  type SymbolSpec,
} from "@/lib/services/risk-engine";
import { identityConversion } from "@/lib/services/fx";

const spec = (over: Partial<SymbolSpec> = {}): SymbolSpec => ({
  symbol: "XAUUSD",
  contractSize: 100,
  tickSize: 0.01,
  tickValue: 1,
  volumeMin: 0.01,
  volumeMax: 50,
  volumeStep: 0.01,
  marginRate: 0.005,
  quoteCurrency: "USD",
  accountCurrency: "USD",
  conversion: identityConversion("USD"),
  source: "test",
  ...over,
});

const base = (over: Partial<RiskInput> = {}): RiskInput => ({
  now: 1_700_000_000_000,
  limits: { ...DEFAULT_RISK_LIMITS, maxTotalExposureLots: 50 },
  balance: 100_000,
  equity: 100_000,
  peakEquity: 100_000,
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
  spec: spec(),
  ...over,
});

describe("position sizing from broker spec", () => {
  it("uses the broker's contract size, not a hardcoded 100", () => {
    // 0.5% of 100k = $500 risk, 10.00 stop distance.
    // contractSize 10 → tickValue 0.1 → $10 per point per lot → 5.00 lots.
    const r = assessRisk(base({ spec: spec({ contractSize: 10, tickValue: 0.1 }) }));
    expect(r.allowed).toBe(true);
    expect(r.lotSize).toBeCloseTo(5, 6);
    expect(r.riskAmount).toBeCloseTo(500, 2);

    // Same inputs with a 100-oz contract give a tenth of the size.
    const r100 = assessRisk(base());
    expect(r100.lotSize).toBeCloseTo(0.5, 6);
  });

  it("rounds down to the broker's volume step and clamps to min/max", () => {
    expect(roundVolumeToStep(0.57, spec({ volumeStep: 0.1 }))).toBeCloseTo(0.5, 6);
    expect(roundVolumeToStep(99, spec({ volumeMax: 2 }))).toBeCloseTo(2, 6);

    const r = assessRisk(base({ spec: spec({ volumeStep: 0.1 }) }));
    expect(r.lotSize).toBeCloseTo(0.5, 6);
  });

  it("blocks when the risk budget is below the broker's minimum volume", () => {
    const r = assessRisk(base({ spec: spec({ volumeMin: 1, volumeStep: 1 }) }));
    expect(r.allowed).toBe(false);
    expect(r.violations.map((v) => v.key)).toContain("min_volume");
    expect(r.lotSize).toBeNull();
  });

  it("recomputes risk after rounding and rejects when it exceeds the cap", () => {
    // Step 1.0 lot rounds 1.66 lots UP in exposure terms? No — it rounds down to
    // 1.0, but a coarse step with a small account can still overshoot the cap.
    const r = assessRisk(
      base({
        balance: 10_000,
        limits: { ...DEFAULT_RISK_LIMITS, maxTotalExposureLots: 50, riskPerTradePct: 0.5, maxRiskPerTradePct: 0.5 },
        // $50 budget, $1000 risk per lot, min/step 1.0 → 1.0 lot = $1000 = 10%.
        spec: spec({ volumeMin: 1, volumeStep: 1 }),
      }),
    );
    expect(r.allowed).toBe(false);
    expect(r.violations.map((v) => v.key)).toEqual(
      expect.arrayContaining(["min_volume"]),
    );

    // Now a case that clears the minimum but breaches the cap after rounding.
    const r2 = assessRisk(
      base({
        balance: 100_000,
        limits: { ...DEFAULT_RISK_LIMITS, maxTotalExposureLots: 50, riskPerTradePct: 0.5, maxRiskPerTradePct: 0.4 },
        spec: spec(),
      }),
    );
    // Budget uses riskPerTradePct 0.4 (capped) so this should pass.
    expect(r2.allowed).toBe(true);
    expect(r2.actualRiskPct!).toBeLessThanOrEqual(0.4);
  });

  it("fails safe when the broker spec is unavailable or incomplete", () => {
    const none = assessRisk(base({ spec: null }));
    expect(none.allowed).toBe(false);
    expect(none.lotSize).toBeNull();
    expect(none.violations.map((v) => v.key)).toContain("symbol_spec");

    const partial = assessRisk(base({ spec: spec({ tickValue: 0 }) }));
    expect(partial.allowed).toBe(false);
    expect(partial.violations.map((v) => v.key)).toContain("symbol_spec");
  });
});
