// React bindings for the framework-free engine layer.
//
// Components subscribe to exactly the slice they render, via
// useSyncExternalStore, so an engine update never re-renders a tree that does
// not depend on it.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { bus, type EngineEventMap, type EngineEventName } from "./event-bus";
import { metrics, type MetricsSnapshot } from "./metrics";
import { engines, type EngineStatus } from "./registry";

/** Subscribe to a single bus channel without re-rendering on other channels. */
export function useEngineEvent<K extends EngineEventName>(
  event: K,
  handler: (payload: EngineEventMap[K]) => void,
): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => bus.on(event, (p) => ref.current(p)), [event]);
}

/** Latest payload of a bus channel, as render state. */
export function useEngineEventValue<K extends EngineEventName>(
  event: K,
  initial: EngineEventMap[K] | null = null,
): EngineEventMap[K] | null {
  const [value, setValue] = useState<EngineEventMap[K] | null>(initial);
  useEngineEvent(event, setValue);
  return value;
}

export function useMetrics(): MetricsSnapshot {
  return useSyncExternalStore(
    useCallback((cb: () => void) => metrics.subscribe(cb), []),
    () => metrics.getSnapshot(),
    () => metrics.getSnapshot(),
  );
}

/** Engine health, polled at a deliberately low frequency. */
export function useEngineStatuses(intervalMs = 2000): EngineStatus[] {
  const [statuses, setStatuses] = useState<EngineStatus[]>(() => engines.statuses());
  useEffect(() => {
    const t = setInterval(() => setStatuses(engines.statuses()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return statuses;
}
