// Typed, synchronous event bus that lives OUTSIDE React.
//
// Engines publish here; React components subscribe only to the specific
// channels they render. This is what allows a 400ms market tick to update the
// price ticker without re-rendering the whole application tree.

import type { MarketQuote } from "@/lib/market-data.types";
import type { ConnectionStatus } from "@/types/platform";

export type DecisionOutcome = "accepted" | "rejected" | "error";

export interface DecisionSnapshot {
  /** Unique id for this evaluation cycle. */
  cycleId: string;
  ts: number;
  symbol: string;
  timeframe: string;
  outcome: DecisionOutcome;
  direction: "BUY" | "SELL" | null;
  confidence: number | null;
  technicalScore: number | null;
  newsScore: number | null;
  /** Human-readable, ordered reasoning lines. */
  reasoning: string[];
  /** Why the trade was NOT taken (empty when accepted). */
  blockers: string[];
  price: number | null;
  spread: number | null;
  latency: Record<string, number>;
  /** Market-environment label for this cycle (services/environment.ts). */
  environment?: string | null;
  environmentConfidence?: number | null;
  payload: Record<string, unknown>;
}


export interface EngineEventMap {
  "market:tick": { quote: MarketQuote; latencyMs: number | null };
  "market:status": { status: ConnectionStatus; error: string | null };
  "ai:started": { cycleId: string; timeframe: string };
  "ai:completed": { cycleId: string; durationMs: number; bias: string | null; confidence: number | null };
  "ai:failed": { cycleId: string; error: string };
  "decision:evaluated": DecisionSnapshot;
  "execution:submitted": { cycleId: string; direction: string; entry: number; lots: number; leg: number; legs: number };
  "execution:failed": { cycleId: string; error: string };
  "position:managed": { tradeId: string; action: string; detail: string };
  "engine:health": { engine: string; healthy: boolean; detail: string | null };
}

export type EngineEventName = keyof EngineEventMap;
type Handler<K extends EngineEventName> = (payload: EngineEventMap[K]) => void;

class EventBus {
  private handlers = new Map<EngineEventName, Set<Handler<EngineEventName>>>();

  on<K extends EngineEventName>(event: K, handler: Handler<K>): () => void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler as Handler<EngineEventName>);
    this.handlers.set(event, set);
    return () => {
      set.delete(handler as Handler<EngineEventName>);
    };
  }

  emit<K extends EngineEventName>(event: K, payload: EngineEventMap[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        (handler as Handler<K>)(payload);
      } catch (error) {
        // A broken subscriber must never take down the trading loop.
        console.error(`[event-bus] subscriber for "${event}" threw`, error);
      }
    }
  }

  listenerCount(): number {
    let n = 0;
    for (const set of this.handlers.values()) n += set.size;
    return n;
  }
}

export const bus = new EventBus();
