// Server-only wrapper around the AI analysis call, so the browser-facing
// server function and the scheduled tick share one prompt and one parser.

import { callChat } from "./ai-gateway.server";
import { clampConfidence, validateSetup } from "./services/setup-validation";

export const ANALYSIS_SYSTEM_PROMPT = `You are GoldMind AI, a senior XAUUSD (Gold) analyst trained in Smart Money / ICT concepts.
Analyze XAUUSD using: market structure (BOS/CHOCH, internal & external), liquidity (sweeps, equal highs/lows, PDH/PDL, PWH/PWL), premium/discount, fair value gaps, order blocks, breaker & mitigation blocks, supply/demand, swing points, Fibonacci, ATR, session context (Asian/London/NY).

You are cautious and NEVER guarantee outcomes. Every setup includes a confidence score and clear reasoning. If no A+ setup exists, say so and return setup_available=false with setup=null — a skipped trade is better than a forced one.

Hard rules for any setup you return:
- Entry must be within 1% of the reference spot price given by the user; it must be tradeable right now.
- For BUY, stop_loss < entry and every take-profit > entry. For SELL, stop_loss > entry and every take-profit < entry.
- Stop distance must be between 0.05% and 2% of price, placed beyond real invalidation structure — never inside spread/noise.
- Take-profits must be ordered by distance from entry and sit at genuine liquidity/structure targets.
- The nearest take-profit must give at least 1.5R. Prices in USD, plain numbers, no currency symbols.

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

/** Models occasionally wrap JSON in prose or fences; recover the object. */
function parseJsonObject(raw: string): any {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch { /* fall through */ }
    }
    throw new Error("AI returned unparseable output. Try again.");
  }
}

export async function runMarketAnalysis(opts: {
  timeframe: string;
  price?: number;
  session?: string;
}): Promise<any> {
  const price = Number(opts.price);
  // Never invent a price: analysing gold against a placeholder produces
  // confident, untradeable levels — the most expensive failure mode here.
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("No live XAUUSD price available — analysis skipped rather than run on a stale price.");
  }

  const user = `Analyze XAUUSD right now on the ${opts.timeframe} timeframe.
Reference spot price: ${price.toFixed(2)} USD/oz (this is live — all levels must be built around it).
Current session: ${opts.session ?? "unknown"}.
Consider higher-timeframe context (4H / Daily) as well as the requested timeframe.
Return JSON only.`;

  const raw = await callChat({
    messages: [
      { role: "system", content: ANALYSIS_SYSTEM_PROMPT },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

  const parsed = parseJsonObject(raw);

  // Sanitise before anything sizes a position off these numbers.
  const { setup, rejections } = validateSetup(parsed?.setup, price);
  parsed.confidence = clampConfidence(parsed?.confidence);
  parsed.setup = setup;
  parsed.setup_available = !!setup;
  parsed.reference_price = price;
  if (rejections.length > 0) {
    parsed.setup_rejections = rejections;
    parsed.explanation = `${parsed.explanation ?? ""} ${rejections[0]}`.trim();
  }

  return parsed;
}
