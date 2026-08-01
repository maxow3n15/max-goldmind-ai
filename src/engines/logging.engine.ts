// Logging Engine — the audit trail.
//
// Every AI decision (accepted AND rejected) is buffered in memory for instant
// UI access and flushed to the database in batches so persistence never sits
// on the execution hot path.

import type { DecisionSnapshot } from "./kernel/event-bus";
import { bus } from "./kernel/event-bus";
import { metrics } from "./kernel/metrics";
import { engines, type Engine } from "./kernel/registry";
import { recordDecisions } from "@/lib/decision-log.functions";

const MAX_BUFFER = 200;
const FLUSH_MS = 8000;
const MAX_BATCH = 25;

export class LoggingEngine implements Engine {
  readonly id = "logging";
  readonly label = "Logging Engine";

  private recent: DecisionSnapshot[] = [];
  private queue: DecisionSnapshot[] = [];
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsub: (() => void) | null = null;
  private lastError: string | null = null;
  private flushed = 0;

  start(): void {
    if (this.unsub) return;
    this.unsub = bus.on("decision:evaluated", (d) => this.append(d));
    this.timer = setInterval(() => void this.flush(), FLUSH_MS);
  }

  stop(): void {
    this.unsub?.();
    this.unsub = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    void this.flush();
  }

  health() {
    return {
      healthy: this.lastError == null,
      detail: this.lastError ?? `${this.flushed} persisted · ${this.queue.length} queued`,
    };
  }

  getRecent(): DecisionSnapshot[] {
    return this.recent;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private append(decision: DecisionSnapshot): void {
    this.recent = [decision, ...this.recent].slice(0, MAX_BUFFER);
    this.queue.push(decision);
    metrics.increment(`decision.${decision.outcome}`);
    for (const l of this.listeners) l();
    // Accepted trades are the audit-critical path — persist immediately.
    if (decision.outcome === "accepted") void this.flush();
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, MAX_BATCH);
    try {
      await recordDecisions({ data: { decisions: batch } });
      this.flushed += batch.length;
      this.lastError = null;
    } catch (error) {
      // Put them back so nothing is silently lost.
      this.queue = [...batch, ...this.queue].slice(0, MAX_BUFFER);
      this.lastError = error instanceof Error ? error.message : "decision flush failed";
    }
  }
}

export const loggingEngine = engines.register(new LoggingEngine()) as LoggingEngine;
