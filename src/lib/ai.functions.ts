import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callChat } from "./ai-gateway.server";
import { newTelemetry, recordAiHealth } from "./ai-health.server";

const AnalyzeInput = z.object({
  timeframe: z.enum(["1", "5", "15", "30", "60", "240", "D"]),
  price: z.number().optional(),
  session: z.string().optional(),
});

export const analyzeMarket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AnalyzeInput.parse(d))
  .handler(async ({ data, context }) => {
    const { runMarketAnalysis } = await import("./ai-analysis.server");
    const { buildEvidence } = await import("./ai-context.server");

    // Same deterministic brief the scheduled tick uses, so a manual analysis
    // and an automated one reason about identical facts.
    const price = Number(data.price);
    let evidence = null;
    if (Number.isFinite(price) && price > 0) {
      const { buildQuantIntel } = await import("./quant.server");
      const { buildMacroReport } = await import("./macro.functions");
      const [quant, macro] = await Promise.all([
        buildQuantIntel(data.timeframe, null).catch(() => null),
        buildMacroReport().catch(() => null),
      ]);
      evidence = await buildEvidence({ timeframe: data.timeframe, price, quant, macro }).catch(() => null);
    }

    const parsed = await runMarketAnalysis({
      timeframe: data.timeframe,
      price: data.price,
      session: data.session,
      userId: context.userId,
      source: "analysis",
      evidence,
    });


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

    const telemetry = newTelemetry();
    let reply: string;
    try {
      reply = await callChat({
      messages: [
        { role: "system", content: `You are GoldMind AI, an expert XAUUSD trading mentor using ICT / Smart Money Concepts. Explain clearly and honestly. Never promise profits. Use plain English. Reference this context when relevant: ${analysisCtx}` },
        ...((history ?? []) as ChatMessage[]),
        { role: "user", content: data.message },
      ],
      temperature: 0.6,
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
      await recordAiHealth({ userId: context.userId, source: "assistant", status, telemetry, error: e?.message });
      throw e;
    }
    await recordAiHealth({ userId: context.userId, source: "assistant", status: "ok", telemetry });

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
