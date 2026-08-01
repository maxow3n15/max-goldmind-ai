// Market Data Engine.
//
// Wraps the transport (HTTP polling today, WebSocket when a streaming source
// is available) and turns it into bus events + latency metrics. Ticks are
// coalesced to one animation frame so a burst of updates costs one render.

import { PollingMarketDataService } from "@/services/market-data.service";
import type { MarketDataService, MarketSnapshot } from "@/types/platform";
import { bus } from "./kernel/event-bus";
import { metrics } from "./kernel/metrics";
import { engines, type Engine } from "./kernel/registry";

export class MarketDataEngine implements Engine {
  readonly id = "market-data";
  readonly label = "Market Data Engine";

  private unsub: (() => void) | null = null;
  private frame: number | null = null;
  private pending: MarketSnapshot | null = null;
  private last: MarketSnapshot | null = null;
  private lastStatus: string | null = null;

  constructor(private readonly service: MarketDataService = new PollingMarketDataService()) {}

  get transport(): MarketDataService {
    return this.service;
  }

  getSnapshot(): MarketSnapshot {
    return this.last ?? this.service.getSnapshot();
  }

  start(): void {
    if (this.unsub) return;
    this.unsub = this.service.subscribe((snapshot) => this.enqueue(snapshot));
    this.service.start();
  }

  stop(): void {
    this.unsub?.();
    this.unsub = null;
    if (this.frame != null && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(this.frame);
    }
    this.frame = null;
    this.service.stop();
  }

  refresh(): Promise<void> {
    return this.service.refresh();
  }

  health() {
    const s = this.getSnapshot();
    return {
      healthy: s.status === "connected",
      detail: s.error ?? `${s.status} · ${s.marketStatus}`,
    };
  }

  /** Coalesce bursts: at most one publish per frame. */
  private enqueue(snapshot: MarketSnapshot): void {
    this.pending = snapshot;
    if (this.frame != null) return;
    const flush = () => {
      this.frame = null;
      const next = this.pending;
      this.pending = null;
      if (next) this.publish(next);
    };
    this.frame = typeof requestAnimationFrame !== "undefined"
      ? requestAnimationFrame(flush)
      : (setTimeout(flush, 16) as unknown as number);
  }

  private publish(snapshot: MarketSnapshot): void {
    const prev = this.last;
    this.last = snapshot;

    if (snapshot.latencyMs != null && snapshot.latencyMs !== prev?.latencyMs) {
      metrics.record("market", snapshot.latencyMs);
    }

    const statusKey = `${snapshot.status}:${snapshot.error ?? ""}`;
    if (statusKey !== this.lastStatus) {
      this.lastStatus = statusKey;
      bus.emit("market:status", { status: snapshot.status, error: snapshot.error });
      bus.emit("engine:health", { engine: this.id, healthy: snapshot.status === "connected", detail: snapshot.error });
    }

    if (snapshot.quote && snapshot.quote.timestamp !== prev?.quote?.timestamp) {
      metrics.increment("market.ticks");
      bus.emit("market:tick", { quote: snapshot.quote, latencyMs: snapshot.latencyMs });
    }
  }
}

/** Process-wide singleton; registered once, shared by every consumer. */
export const marketDataEngine = engines.register(new MarketDataEngine()) as MarketDataEngine;
