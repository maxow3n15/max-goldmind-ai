import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { analyzeMarket } from "@/lib/ai.functions";
import { currentSession } from "@/lib/format";
import { computeConfluence } from "@/lib/services/confidence";
import { setDiagnostics } from "@/lib/platform-context";
import { useMarketDataContext } from "./MarketDataProvider";
import { useNotifications } from "./NotificationProvider";
import type { AIAnalysis } from "@/types/platform";
import type { ConfluenceReport } from "@/lib/services/types";

export const AI_CONFIDENCE_THRESHOLD = 76;

interface AIContextValue {
  analysis: AIAnalysis | null;
  confluence: ConfluenceReport | null;
  analysing: boolean;
  error: string | null;
  lastAnalysisAt: number | null;
  timeframe: string;
  setTimeframe: (tf: string) => void;
  belowThreshold: boolean;
  thresholdReason: string | null;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AIContextValue | null>(null);

/** Re-analyse when price drifts more than this fraction. */
const DRIFT = 0.0015;

export function AIProvider({
  children,
  intervalMs = 120_000,
}: {
  children: ReactNode;
  intervalMs?: number;
}) {
  const market = useMarketDataContext();
  const { notify } = useNotifications();
  const analyzeFn = useServerFn(analyzeMarket);

  const [timeframe, setTimeframe] = useState("15");
  const [analysis, setAnalysis] = useState<AIAnalysis | null>(null);
  const [confluence, setConfluence] = useState<ConfluenceReport | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inFlight = useRef(false);
  const lastAt = useRef<number | null>(null);
  const lastPrice = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    const price = market.quote?.mid;
    if (!price) return;
    inFlight.current = true;
    setAnalysing(true);
    setDiagnostics({ aiStatus: "analysing", timeframe });
    try {
      const raw: any = await analyzeFn({
        data: { timeframe: timeframe as any, session: currentSession(), price },
      });
      const next: AIAnalysis = {
        bias: raw?.bias ?? null,
        confidence: Number(raw?.confidence ?? 0),
        market_structure: raw?.market_structure ?? null,
        liquidity: raw?.liquidity ?? null,
        order_block: raw?.order_block ?? raw?.market_structure ?? null,
        fair_value_gap: raw?.fair_value_gap ?? raw?.liquidity ?? null,
        session_context: raw?.session_context ?? null,
        explanation: raw?.explanation ?? null,
        invalidation: raw?.invalidation ?? null,
        setup: raw?.setup ?? null,
        strategy: raw?.setup ? "ICT / Smart Money — liquidity sweep continuation" : "Observation only",
        generatedAt: Date.now(),
      };
      setAnalysis(next);
      setConfluence(
        computeConfluence({ analysis: raw, htfBias: raw?.bias ?? null, spread: market.quote?.spread ?? null }),
      );
      setError(null);
      lastAt.current = Date.now();
      lastPrice.current = price;
      setDiagnostics({ aiStatus: `ready:${next.bias ?? "?"}` });
    } catch (e: any) {
      const msg = e?.message ?? "AI analysis failed";
      setError(msg);
      setDiagnostics({ aiStatus: "error" });
      notify("error", "AI analysis failed", msg);
    } finally {
      inFlight.current = false;
      setAnalysing(false);
    }
  }, [analyzeFn, market.quote?.mid, market.quote?.spread, notify, timeframe]);

  // Refresh whenever new market data arrives (rate-limited by interval/drift).
  useEffect(() => {
    const price = market.quote?.mid;
    if (!price) return;
    const since = lastAt.current == null ? Infinity : Date.now() - lastAt.current;
    const drift = lastPrice.current ? Math.abs(price - lastPrice.current) / lastPrice.current : 1;
    if (since >= intervalMs || drift > DRIFT) void refresh();
  }, [market.quote?.mid, intervalMs, refresh]);

  // Re-run when the trader switches timeframe.
  useEffect(() => {
    lastAt.current = null;
  }, [timeframe]);

  const score = confluence?.score ?? analysis?.confidence ?? 0;
  const belowThreshold = !!analysis && score < AI_CONFIDENCE_THRESHOLD;
  const thresholdReason = belowThreshold
    ? (confluence?.detracting?.[0] ??
        `Confluence ${Math.round(score)}% is below the ${AI_CONFIDENCE_THRESHOLD}% execution threshold.`)
    : null;

  const value = useMemo<AIContextValue>(
    () => ({
      analysis, confluence, analysing, error,
      lastAnalysisAt: lastAt.current,
      timeframe, setTimeframe, belowThreshold, thresholdReason, refresh,
    }),
    [analysis, confluence, analysing, error, timeframe, belowThreshold, thresholdReason, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAI(): AIContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAI must be used inside <AIProvider>");
  return ctx;
}
