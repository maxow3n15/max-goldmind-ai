// Latency + throughput instrumentation.
//
// Every measurable stage of the pipeline records a span here. The registry
// keeps a rolling window per channel and derives last/avg/p95/max so the
// diagnostics dashboard shows real numbers rather than estimates.

export type LatencyChannel =
  | "market"
  | "ai"
  | "quant"
  | "macro"
  | "confluence"
  | "strategy"
  | "risk"
  | "broker"
  | "execution"
  | "endToEnd";

export interface LatencyStat {
  channel: LatencyChannel;
  last: number | null;
  avg: number | null;
  p95: number | null;
  max: number | null;
  count: number;
}

export interface MetricsSnapshot {
  ts: number;
  latency: Record<LatencyChannel, LatencyStat>;
  counters: Record<string, number>;
  cache: { hits: number; misses: number; hitRate: number | null };
  /** JS heap in MB when the browser exposes it. */
  heapUsedMb: number | null;
  heapLimitMb: number | null;
  busListeners: number;
}

const WINDOW = 60;

const CHANNELS: LatencyChannel[] = [
  "market", "ai", "quant", "macro", "confluence",
  "strategy", "risk", "broker", "execution", "endToEnd",
];

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

class MetricsRegistry {
  private samples = new Map<LatencyChannel, number[]>();
  private counters = new Map<string, number>();
  private hits = 0;
  private misses = 0;
  private listeners = new Set<() => void>();
  private snapshot: MetricsSnapshot = this.build();
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  /** Start timing. Call the returned function when the stage completes. */
  start(channel: LatencyChannel): (() => number) {
    const t0 = now();
    return () => {
      const ms = now() - t0;
      this.record(channel, ms);
      return ms;
    };
  }

  record(channel: LatencyChannel, ms: number): void {
    const arr = this.samples.get(channel) ?? [];
    arr.push(ms);
    if (arr.length > WINDOW) arr.shift();
    this.samples.set(channel, arr);
    this.markDirty();
  }

  increment(key: string, by = 1): void {
    this.counters.set(key, (this.counters.get(key) ?? 0) + by);
    this.markDirty();
  }

  cacheHit(): void {
    this.hits += 1;
    this.markDirty();
  }

  cacheMiss(): void {
    this.misses += 1;
    this.markDirty();
  }

  getSnapshot(): MetricsSnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notifications are coalesced to 4Hz. Metrics must never be the reason the
   * UI re-renders on every tick.
   */
  private markDirty(): void {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (!this.dirty) return;
      this.dirty = false;
      this.snapshot = this.build();
      for (const l of this.listeners) l();
    }, 250);
  }

  private statFor(channel: LatencyChannel): LatencyStat {
    const arr = this.samples.get(channel) ?? [];
    if (arr.length === 0) {
      return { channel, last: null, avg: null, p95: null, max: null, count: 0 };
    }
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    return {
      channel,
      last: Math.round(arr[arr.length - 1]),
      avg: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length),
      p95: Math.round(sorted[idx]),
      max: Math.round(sorted[sorted.length - 1]),
      count: arr.length,
    };
  }

  private build(): MetricsSnapshot {
    const latency = {} as Record<LatencyChannel, LatencyStat>;
    for (const c of CHANNELS) latency[c] = this.statFor(c);

    const memory = (typeof performance !== "undefined"
      ? (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory
      : undefined);

    const total = this.hits + this.misses;
    return {
      ts: Date.now(),
      latency,
      counters: Object.fromEntries(this.counters),
      cache: { hits: this.hits, misses: this.misses, hitRate: total ? this.hits / total : null },
      heapUsedMb: memory ? +(memory.usedJSHeapSize / 1048576).toFixed(1) : null,
      heapLimitMb: memory ? +(memory.jsHeapSizeLimit / 1048576).toFixed(1) : null,
      busListeners: 0,
    };
  }
}

export const metrics = new MetricsRegistry();

/** Time an async stage and record it. */
export async function timed<T>(channel: LatencyChannel, fn: () => Promise<T>): Promise<T> {
  const end = metrics.start(channel);
  try {
    return await fn();
  } finally {
    end();
  }
}
