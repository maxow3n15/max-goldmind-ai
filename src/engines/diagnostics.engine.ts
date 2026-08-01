// Diagnostics Engine — aggregates runtime health for the developer dashboard.
//
// It owns no data of its own: it samples the metrics registry, the engine
// registry and browser runtime counters on a slow cadence.

import { bus } from "./kernel/event-bus";
import { metrics, type MetricsSnapshot } from "./kernel/metrics";
import { engines, type Engine, type EngineStatus } from "./kernel/registry";

export interface DiagnosticsSnapshot {
  ts: number;
  metrics: MetricsSnapshot;
  engines: EngineStatus[];
  /** Rolling estimate of UI frame budget health. */
  fps: number | null;
  uptimeMs: number;
  online: boolean;
}

export class DiagnosticsEngine implements Engine {
  readonly id = "diagnostics";
  readonly label = "Diagnostics Engine";

  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private frameHandle: number | null = null;
  private frames = 0;
  private fpsWindowStart = 0;
  private fps: number | null = null;
  private startedAt = Date.now();
  private snapshot: DiagnosticsSnapshot = this.build();
  private unsubHealth: (() => void) | null = null;

  start(): void {
    if (this.timer) return;
    this.startedAt = Date.now();
    this.fpsWindowStart = typeof performance !== "undefined" ? performance.now() : Date.now();
    this.timer = setInterval(() => this.publish(), 1000);
    this.unsubHealth = bus.on("engine:health", () => this.publish());
    this.sampleFrames();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unsubHealth?.();
    this.unsubHealth = null;
    if (this.frameHandle != null && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(this.frameHandle);
    }
    this.frameHandle = null;
  }

  health() {
    return { healthy: true, detail: this.fps != null ? `${this.fps} fps` : null };
  }

  getSnapshot(): DiagnosticsSnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private sampleFrames(): void {
    if (typeof requestAnimationFrame === "undefined") return;
    const tick = () => {
      this.frames += 1;
      const t = performance.now();
      if (t - this.fpsWindowStart >= 1000) {
        this.fps = Math.round((this.frames * 1000) / (t - this.fpsWindowStart));
        this.frames = 0;
        this.fpsWindowStart = t;
      }
      this.frameHandle = requestAnimationFrame(tick);
    };
    this.frameHandle = requestAnimationFrame(tick);
  }

  private build(): DiagnosticsSnapshot {
    return {
      ts: Date.now(),
      metrics: metrics.getSnapshot(),
      engines: engines.statuses(),
      fps: this.fps,
      uptimeMs: Date.now() - this.startedAt,
      online: typeof navigator === "undefined" ? true : navigator.onLine,
    };
  }

  private publish(): void {
    this.snapshot = this.build();
    for (const l of this.listeners) l();
  }
}

export const diagnosticsEngine = engines.register(new DiagnosticsEngine()) as DiagnosticsEngine;
