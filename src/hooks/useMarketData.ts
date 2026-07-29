import { useEffect, useRef, useState, useCallback } from "react";
import type { ConnectionStatus, MarketDataEnvelope, MarketQuote } from "@/lib/market-data.types";

interface Options {
  intervalMs?: number; // poll cadence when connected
  staleMs?: number;    // mark disconnected if no update for this long
}

interface State {
  quote: MarketQuote | null;   // most recent successful quote (kept on disconnect)
  status: ConnectionStatus;
  lastError: string | null;
  lastUpdated: number | null;
}

const ENDPOINT = "/api/public/market/xauusd";

export function useMarketData({ intervalMs = 2500, staleMs = 15_000 }: Options = {}) {
  const [state, setState] = useState<State>({
    quote: null,
    status: "reconnecting",
    lastError: null,
    lastUpdated: null,
  });
  const timerRef = useRef<number | null>(null);
  const failCountRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const tick = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch(ENDPOINT, { signal: ctrl.signal, cache: "no-store" });
      const body = (await res.json()) as MarketDataEnvelope;
      if (!body.ok || !body.quote) throw new Error(body.error ?? "no quote");
      failCountRef.current = 0;
      setState({
        quote: body.quote,
        status: "connected",
        lastError: null,
        lastUpdated: Date.now(),
      });
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      failCountRef.current += 1;
      setState((s) => {
        const stale = s.lastUpdated == null || Date.now() - s.lastUpdated > staleMs;
        return {
          ...s,
          status: stale && failCountRef.current > 2 ? "disconnected" : "reconnecting",
          lastError: e?.message ?? "fetch failed",
        };
      });
    }
  }, [staleMs]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    tick();
    // Exponential-ish backoff cadence: base interval, extended when failing.
    const schedule = () => {
      const delay = failCountRef.current === 0
        ? intervalMs
        : Math.min(intervalMs * 2 ** failCountRef.current, 30_000);
      timerRef.current = window.setTimeout(async () => {
        await tick();
        schedule();
      }, delay);
    };
    schedule();
    const onVis = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      abortRef.current?.abort();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [intervalMs, tick]);

  return { ...state, refresh: tick };
}
