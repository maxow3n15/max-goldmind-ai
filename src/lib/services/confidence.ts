// Confidence engine — turns the AI's structured analysis into a weighted
// confluence report. Uses ONLY signals produced by the AI or the market
// data feed. Never randomises.

import type { ConfluenceReport, CheckResult } from "./types";

interface Input {
  analysis: any | null;
  htfBias?: "bullish" | "bearish" | "neutral" | null;
  spread?: number | null;
  atrPct?: number | null; // recent volatility as a % of price (0..1)
}

const WEIGHTS = {
  htf_alignment: 15,
  structure: 12,
  liquidity: 10,
  order_block: 10,
  fvg: 8,
  rr: 12,
  ema: 8,
  momentum: 8,
  session: 5,
  spread: 6,
  invalidation: 6,
} as const;

export function computeConfluence({ analysis, htfBias, spread }: Input): ConfluenceReport {
  const breakdown: CheckResult[] = [];
  const supporting: string[] = [];
  const detracting: string[] = [];

  const setup = analysis?.setup ?? null;
  const bias: string | null = analysis?.bias ?? null;

  const push = (key: keyof typeof WEIGHTS, label: string, passed: boolean, detail?: string) => {
    breakdown.push({ key, label, passed, detail, weight: WEIGHTS[key] });
    (passed ? supporting : detracting).push(`${label}${detail ? ` — ${detail}` : ""}`);
  };

  push("htf_alignment", "Higher-timeframe bias alignment",
    !!(htfBias && bias && htfBias === bias),
    htfBias ? `HTF ${htfBias} vs setup ${bias ?? "n/a"}` : "HTF bias unknown");
  push("structure", "Market structure (BOS/CHOCH)",
    typeof analysis?.market_structure === "string" && analysis.market_structure.length > 8,
    analysis?.market_structure);
  push("liquidity", "Liquidity sweep / draw",
    typeof analysis?.liquidity === "string" && /(sweep|liquidity|equal|pdh|pdl)/i.test(analysis.liquidity),
    analysis?.liquidity);
  push("order_block", "Order block present",
    /order block|ob/i.test(analysis?.market_structure ?? "") || /order block|ob/i.test(analysis?.liquidity ?? ""));
  push("fvg", "Fair value gap respected",
    /fvg|fair value gap|imbalance/i.test(analysis?.market_structure ?? "") || /fvg|imbalance/i.test(analysis?.liquidity ?? ""));
  push("rr", "Risk / reward ≥ 2:1",
    Number(setup?.risk_reward ?? 0) >= 2,
    setup ? `R:R ${Number(setup.risk_reward ?? 0).toFixed(2)}` : "no setup");
  push("ema", "EMA trend alignment",
    /ema|moving average|trend/i.test(analysis?.session_context ?? "") || /ema/i.test(analysis?.market_structure ?? ""));
  push("momentum", "Momentum confirmation",
    /momentum|impulse|displacement/i.test(analysis?.market_structure ?? "") || /momentum/i.test(analysis?.liquidity ?? ""));
  push("session", "Active session appropriate",
    /(london|new york|ny)/i.test(analysis?.session_context ?? ""),
    analysis?.session_context);
  push("spread", "Spread acceptable",
    spread == null || spread <= 0.5,
    spread != null ? `${spread.toFixed(2)}` : undefined);
  push("invalidation", "Invalidation clearly defined",
    typeof analysis?.invalidation === "string" && analysis.invalidation.length > 8,
    analysis?.invalidation);

  // Weighted score. AI's own confidence acts as an anchor when available.
  const total = breakdown.reduce((a, b) => a + (b.weight ?? 0), 0);
  const gained = breakdown.filter((b) => b.passed).reduce((a, b) => a + (b.weight ?? 0), 0);
  const weighted = total ? (gained / total) * 100 : 0;
  const aiScore = Number(analysis?.confidence ?? 0);
  const score = aiScore ? Math.round((aiScore * 0.6 + weighted * 0.4)) : Math.round(weighted);

  return { score, supporting, detracting, breakdown };
}
