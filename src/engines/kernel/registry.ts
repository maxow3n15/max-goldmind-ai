// Engine registry — lifecycle + health for every independent engine.
//
// An "engine" is a long-lived, framework-free unit of the platform (market
// data, logging, diagnostics...). React mounts them once; they keep running
// regardless of which route is on screen.

import { bus } from "./event-bus";

export interface Engine {
  readonly id: string;
  readonly label: string;
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
  /** Cheap health probe used by the diagnostics dashboard. */
  health(): { healthy: boolean; detail: string | null };
}

export interface EngineStatus {
  id: string;
  label: string;
  running: boolean;
  healthy: boolean;
  detail: string | null;
  startedAt: number | null;
}

class EngineRegistry {
  private engines = new Map<string, Engine>();
  private startedAt = new Map<string, number>();

  register(engine: Engine): Engine {
    const existing = this.engines.get(engine.id);
    if (existing) return existing;
    this.engines.set(engine.id, engine);
    return engine;
  }

  get(id: string): Engine | undefined {
    return this.engines.get(id);
  }

  async startAll(): Promise<void> {
    for (const engine of this.engines.values()) {
      if (this.startedAt.has(engine.id)) continue;
      await engine.start();
      this.startedAt.set(engine.id, Date.now());
      const h = engine.health();
      bus.emit("engine:health", { engine: engine.id, healthy: h.healthy, detail: h.detail });
    }
  }

  async stopAll(): Promise<void> {
    for (const engine of this.engines.values()) {
      if (!this.startedAt.has(engine.id)) continue;
      await engine.stop();
      this.startedAt.delete(engine.id);
    }
  }

  statuses(): EngineStatus[] {
    return [...this.engines.values()].map((e) => {
      const h = e.health();
      return {
        id: e.id,
        label: e.label,
        running: this.startedAt.has(e.id),
        healthy: h.healthy,
        detail: h.detail,
        startedAt: this.startedAt.get(e.id) ?? null,
      };
    });
  }
}

export const engines = new EngineRegistry();
