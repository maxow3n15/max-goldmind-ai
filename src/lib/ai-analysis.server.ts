// Server-only wrapper around the AI analysis call, so the browser-facing
// server function and the scheduled tick share one prompt and one parser.

import { callChat } from "./ai-gateway.server";

export const ANALYSIS_SYSTEM_PROMPT = `You are GoldMind AI, a senior XAUUSD (Gold) analyst trained in Smart Money / ICT concepts.
Analyze XAUUSD using: market structure (BOS/CHOCH, internal & external), liquidity (sweeps, equal highs/lows, PDH/PDL, PWH/PWL), premium/discount, fair value gaps, order blocks, breaker & mitigation blocks, supply/demand, swing points, Fibonacci, ATR, session context (Asian/London/NY).

You are cautious and NEVER guarantee outcomes. Every setup includes a confidence score and clear reasoning. If no A+ setup exists, say so.

Respond ONLY with valid JSON matching:
{
  "bias": "bullish" | "bearish" | "neutral",
  "confidence": number (0-100),
  "market_structure": string,
  "liquidity": string,
  "session_context": string,
  "setup_available": boolean,
  "setup": {
    "direction": "BUY" | "SELL",
    "entry": number,
    "stop_loss": number,
    "take_profit_1": number,
    "take_profit_2": number,
    "take_profit_3": number,
    "risk_reward": number,
    "expected_hold_hours": number,
    "probability_rating": "low" | "medium" | "high",
    "suggested_risk_pct": number
  } | null,
  "explanation": string (2-4 sentences, plain-English trader-to-trader),
  "invalidation": string
}`;

export async function runMarketAnalysis(opts: {
  timeframe: string;
  price?: number;
  session?: string;
}): Promise<any> {
  const price = opts.price ?? 2650;
  const user = `Analyze XAUUSD right now on the ${opts.timeframe} timeframe.
Reference spot price: ~${price} USD/oz.
Current session: ${opts.session ?? "unknown"}.
Consider higher-timeframe context (4H / Daily) as well as the requested timeframe.
Return JSON only.`;

  const raw = await callChat({
    messages: [
      { role: "system", content: ANALYSIS_SYSTEM_PROMPT },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    temperature: 0.5,
  });

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("AI returned unparseable output. Try again.");
  }
}
