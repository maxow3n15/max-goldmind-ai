// Server-only wrapper around the AI analysis call, so the browser-facing
// server function and the scheduled tick share one prompt and one parser.

import { callChat } from "./ai-gateway.server";
import { newTelemetry, recordAiHealth } from "./ai-health.server";
import { clampConfidence, validateSetup } from "./services/setup-validation";

export const ANALYSIS_SYSTEM_PROMPT = `You are GoldMind AI, a senior XAUUSD (Gold) analyst trained in Smart Money / ICT concepts.

CRITICAL — SOURCE OF TRUTH
The user message contains a DETERMINISTIC EVIDENCE block computed by the platform from real OHLCV data: multi-timeframe structure (BOS/CHOCH, FVGs, order blocks, breakers, sweeps, premium/discount), reference liquidity levels, session ranges, quantitative modules, the economic calendar and the macro read. That block is the ONLY factual input you have. You cannot see a chart and you have no market data of your own.
- Reason strictly from the evidence block. Never assert a level, pattern, indicator value or event that is not in it.
- Every claim in your explanation must be traceable to a line of the evidence block.
- If the evidence block lists any DATA GAPS, you MUST return setup_available=false and setup=null.
- If the evidence does not contain a clean, high-quality confluence, return setup_available=false. A skipped trade is better than a forced one.

Interpret the evidence using: market structure (BOS/CHOCH, internal & external), liquidity (sweeps, equal highs/lows, PDH/PDL, session highs/lows), premium/discount positioning, fair value gaps, order blocks, breaker & mitigation blocks, ATR-based invalidation, and session context (Asian/London/NY).

You are cautious and NEVER guarantee outcomes. Every setup includes a confidence score and clear reasoning grounded in the evidence.


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

export interface AnalysisEvidence {
  text: string;
  insufficient: boolean;
  insufficientReasons: string[];
}

export async function runMarketAnalysis(opts: {
  timeframe: string;
  price?: number;
  session?: string;
  /** When present, every call outcome is logged to the AI health panel. */
  userId?: string | null;
  source?: string;
  /**
   * Deterministic evidence brief from ai-context.server. Strongly recommended:
   * without it the model has no facts to reason from and can only guess.
   */
  evidence?: AnalysisEvidence | null;
}): Promise<any> {
  const telemetry = newTelemetry();
  const source = opts.source ?? "analysis";
  const price = Number(opts.price);
  // Never invent a price: analysing gold against a placeholder produces
  // confident, untradeable levels — the most expensive failure mode here.
  if (!Number.isFinite(price) || price <= 0) {
    const msg = "No live XAUUSD price available — analysis skipped rather than run on a stale price.";
    await recordAiHealth({ userId: opts.userId, source, status: "no_price", telemetry, error: msg });
    throw new Error(msg);
  }

  const evidence = opts.evidence ?? null;

  // Hard gap: refuse before spending a model call. A setup built on top of a
  // known data hole is worse than no setup, and the model would happily
  // produce one if asked.
  if (evidence?.insufficient) {
    await recordAiHealth({
      userId: opts.userId, source, status: "validation_reject", telemetry,
      error: evidence.insufficientReasons[0],
    });
    return {
      bias: "neutral",
      confidence: 0,
      market_structure: "Not assessed — deterministic evidence incomplete.",
      liquidity: "Not assessed.",
      session_context: opts.session ?? "unknown",
      setup_available: false,
      setup: null,
      explanation: `Analysis skipped: ${evidence.insufficientReasons.join(" ")}`,
      invalidation: "n/a",
      reference_price: price,
      evidence_gaps: evidence.insufficientReasons,
      skipped: true,
    };
  }

  const user = `Analyze XAUUSD right now on the ${opts.timeframe} timeframe.
Reference spot price: ${price.toFixed(2)} USD/oz (this is live — all levels must be built around it).
Current session: ${opts.session ?? "unknown"}.

${evidence?.text ?? "=== DETERMINISTIC EVIDENCE ===\n(unavailable this cycle — you have no verified structural data, so you MUST return setup_available=false)\n=== END EVIDENCE ==="}

Interpret the evidence above and return JSON only.`;


  let raw: string;
  try {
    raw = await callChat({
      messages: [
        { role: "system", content: ANALYSIS_SYSTEM_PROMPT },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    }, telemetry);
  } catch (e: any) {
    const status = telemetry.timeouts > 0
      ? "timeout"
      : telemetry.rateLimits > 0
        ? "rate_limited"
        : telemetry.emptyResponses > 0
          ? "empty_response"
          : telemetry.upstreamErrors > 0
            ? "upstream_error"
            : "error";
    await recordAiHealth({ userId: opts.userId, source, status, telemetry, error: e?.message });
    throw e;
  }

  let parsed: any;
  try {
    parsed = parseJsonObject(raw);
  } catch (e: any) {
    telemetry.parseErrors += 1;
    await recordAiHealth({ userId: opts.userId, source, status: "parse_error", telemetry, error: e?.message });
    throw e;
  }

  // Sanitise before anything sizes a position off these numbers.
  const { setup, rejections } = validateSetup(parsed?.setup, price);
  parsed.confidence = clampConfidence(parsed?.confidence);
  parsed.setup = setup;
  parsed.setup_available = !!setup;
  parsed.reference_price = price;
  parsed.evidence_provided = !!evidence;

  // Belt and braces: a setup produced without deterministic evidence is an
  // unsourced guess, whatever the model claimed. Drop it rather than let it
  // reach sizing.
  if (!evidence && parsed.setup) {
    rejections.push("Setup discarded: produced without a deterministic evidence brief.");
    parsed.setup = null;
    parsed.setup_available = false;
  }

  if (rejections.length > 0) {
    parsed.setup_rejections = rejections;
    parsed.explanation = `${parsed.explanation ?? ""} ${rejections[0]}`.trim();
    telemetry.validationRejects = rejections.length;
    telemetry.rejectionReasons = rejections;
  }

  await recordAiHealth({
    userId: opts.userId,
    source,
    status: rejections.length > 0 ? "validation_reject" : "ok",
    telemetry,
  });

  return parsed;
}

