// HTTP polling market data service with automatic reconnection, latency
// tracking and a mock fallback so the UI is never dead.
//
// A WebSocket implementation can subclass/replace this: it only needs to
// satisfy `MarketDataService` and push snapshots to `emit()`.

import type {
  ConnectionStatus,
  MarketDataService,
  MarketSnapshot,
  MarketStatus,
} from "@/types/platform";
import type { MarketDataEnvelope, MarketQuote } from "@/lib/market-data.types";

const ENDPOINT = "/api/public/market/xauusd";

/** Gold is closed from Friday 21:00 UTC to Sunday 22:00 UTC. */
export function computeMarketStatus(d: Date = new Date()): MarketStatus {
  const day = d.getUTCDay();
  const h = d.getUTCHours();
  if (day === 6) return "closed";
  if (day === 5 && h >= 21) return "closed";
  if (day === 0 && h < 22) return "closed";
  return "open";
}

function mockQuote(prev: MarketQuote | null): MarketQuote {
  const base = prev?.mid ?? 2650;
  const mid = +(base + (Math.random() - 0.5) * 1.2).toFixed(3);
  const half = 0.15;
  return {
    symbol: "XAUUSD",
    bid: +(mid - half).toFixed(2),
    ask: +(mid + half).toFixed(2),
    spread: +(half * 2).toFixed(3),
    mid,
    timestamp: Date.now(),
    source: "Simulated feed (backend unavailable)",
    simulated: true,
  };
}

export interface PollingOptions {
  intervalMs?: number;
  staleMs?: number;
  /** Fall back to a simulated feed after this many consecutive failures. */
  mockAfterFailures?: number;
}

export class PollingMarketDataService implements MarketDataService {
  readonly id = "polling-http";
  private listeners = new Set<(s: MarketSnapshot) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private abort: AbortController | null = null;
  private failures = 0;
  private started = false;
  private readonly intervalMs: number;
  private readonly staleMs: number;
  private readonly mockAfterFailures: number;

  private snapshot: MarketSnapshot = {
    quote: null,
    status: "reconnecting",
    marketStatus: "unknown",
    lastUpdated: null,
    latencyMs: null,
    error: null,
    loading: true,
  };

  constructor(opts: PollingOptions = {}) {
    this.intervalMs = opts.intervalMs ?? 2500;
    this.staleMs = opts.staleMs ?? 15_000;
    this.mockAfterFailures = opts.mockAfterFailures ?? 3;
  }

  getSnapshot() {
    return this.snapshot;
  }

  subscribe(listener: (s: MarketSnapshot) => void) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(patch: Partial<MarketSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch, marketStatus: computeMarketStatus() };
    for (const l of this.listeners) l(this.snapshot);
  }

  start() {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    void this.refresh();
    this.schedule();
  }

  stop() {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.abort?.abort();
  }

  private schedule() {
    if (!this.started) return;
    const delay =
      this.failures === 0
        ? this.intervalMs
        : Math.min(this.intervalMs * 2 ** this.failures, 30_000);
    this.timer = setTimeout(async () => {
      await this.refresh();
      this.schedule();
    }, delay);
  }

  async refresh() {
    this.abort?.abort();
    const ctrl = new AbortController();
    this.abort = ctrl;
    const started = performance.now();
    try {
      const res = await fetch(ENDPOINT, { signal: ctrl.signal, cache: "no-store" });
      const body = (await res.json()) as MarketDataEnvelope;
      if (!body.ok || !body.quote) throw new Error(body.error ?? "no quote returned");
      this.failures = 0;
      this.emit({
        quote: body.quote,
        status: "connected",
        error: null,
        loading: false,
        lastUpdated: Date.now(),
        latencyMs: Math.round(performance.now() - started),
      });
    } catch (e: unknown) {
      if ((e as { name?: string })?.name === "AbortError") return;
      this.failures += 1;
      const message = (e as Error)?.message ?? "market feed unreachable";
      const stale =
        this.snapshot.lastUpdated == null ||
        Date.now() - this.snapshot.lastUpdated > this.staleMs;

      if (this.failures >= this.mockAfterFailures) {
        // Keep the terminal usable with a clearly-labelled simulated feed.
        const quote = mockQuote(this.snapshot.quote);
        this.emit({
          quote,
          status: "reconnecting",
          error: `${message} — using simulated prices`,
          loading: false,
          lastUpdated: Date.now(),
          latencyMs: null,
        });
        return;
      }

      const status: ConnectionStatus = stale ? "disconnected" : "reconnecting";
      this.emit({ status, error: message, loading: false });
    }
  }
}
