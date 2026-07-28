import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callChat } from "./ai-gateway.server";

const AnalyzeInput = z.object({
  timeframe: z.enum(["1", "5", "15", "30", "60", "240", "D"]),
  price: z.number().optional(),
  session: z.string().optional(),
});

const SYSTEM_PROMPT = `You are GoldMind AI, a senior XAUUSD (Gold) analyst trained in Smart Money / ICT concepts.
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

export const analyzeMarket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AnalyzeInput.parse(d))
  .handler(async ({ data, context }) => {
    const price = data.price ?? 2650;
    const user = `Analyze XAUUSD right now on the ${data.timeframe} timeframe.
Reference spot price: ~${price} USD/oz.
Current session: ${data.session ?? "unknown"}.
Consider higher-timeframe context (4H / Daily) as well as the requested timeframe.
Return JSON only.`;

    const raw = await callChat({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0.5,
    });

    let parsed: any;
    try { parsed = JSON.parse(raw); }
    catch { throw new Error("AI returned unparseable output. Try again."); }

    const { error } = await context.supabase.from("ai_analyses").insert({
      user_id: context.userId,
      symbol: "XAUUSD",
      timeframe: data.timeframe,
      bias: parsed.bias ?? null,
      confidence: parsed.confidence ?? null,
      setup: parsed,
      explanation: parsed.explanation ?? "",
    });
    if (error) console.error("save analysis error", error);

    return parsed;
  });

const ChatInput = z.object({
  message: z.string().min(1).max(2000),
});

export const askAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ChatInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: history } = await context.supabase
      .from("chat_messages")
      .select("role, content")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: true })
      .limit(20);

    const { data: latestAnalysis } = await context.supabase
      .from("ai_analyses")
      .select("timeframe, bias, confidence, explanation, setup, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const analysisCtx = latestAnalysis
      ? `Latest analysis (${latestAnalysis.timeframe}, ${latestAnalysis.bias}, confidence ${latestAnalysis.confidence}): ${latestAnalysis.explanation}`
      : "No recent analysis available.";

    await context.supabase.from("chat_messages").insert({
      user_id: context.userId, role: "user", content: data.message,
    });

    const reply = await callChat({
      messages: [
        { role: "system", content: `You are GoldMind AI, an expert XAUUSD trading mentor using ICT / Smart Money Concepts. Explain clearly and honestly. Never promise profits. Use plain English. Reference this context when relevant: ${analysisCtx}` },
        ...((history ?? []) as ChatMessage[]),
        { role: "user", content: data.message },
      ],
      temperature: 0.6,
    });

    await context.supabase.from("chat_messages").insert({
      user_id: context.userId, role: "assistant", content: reply,
    });

    return { reply };
  });

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export const getChatHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("chat_messages")
      .select("id, role, content, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: true })
      .limit(50);
    return data ?? [];
  });
