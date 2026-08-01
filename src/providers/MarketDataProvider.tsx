import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { marketDataEngine } from "@/engines/market-data.engine";
import { loggingEngine } from "@/engines/logging.engine";
import { diagnosticsEngine } from "@/engines/diagnostics.engine";
import { engines } from "@/engines/kernel/registry";
import { setDiagnostics } from "@/lib/platform-context";
import type { MarketDataService, MarketSnapshot } from "@/types/platform";

interface MarketDataContextValue extends MarketSnapshot {
  service: MarketDataService;
  refresh: () => Promise<void>;
}

const Ctx = createContext<MarketDataContextValue | null>(null);

/**
 * Boots the framework-free engine layer (market data, logging, diagnostics)
 * and exposes the market snapshot to React. The engines themselves keep
 * running independently of which route is mounted.
 */
export function MarketDataProvider({
  children,
  service,
}: {
  children: ReactNode;
  service?: MarketDataService;
}) {
  const transport = service ?? marketDataEngine.transport;
  const [snapshot, setSnapshot] = useState<MarketSnapshot>(() => transport.getSnapshot());

  useEffect(() => {
    // Ensure every engine is registered before the first start pass.
    engines.register(marketDataEngine);
    engines.register(loggingEngine);
    engines.register(diagnosticsEngine);

    const unsub = transport.subscribe(setSnapshot);
    void engines.startAll();
    return () => {
      unsub();
      void engines.stopAll();
    };
  }, [transport]);

  useEffect(() => {
    setDiagnostics({ marketStatus: `${snapshot.status}/${snapshot.marketStatus}` });
  }, [snapshot.status, snapshot.marketStatus]);

  const value = useMemo<MarketDataContextValue>(
    () => ({ ...snapshot, service: transport, refresh: () => transport.refresh() }),
    [snapshot, transport],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMarketDataContext(): MarketDataContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useMarketDataContext must be used inside <MarketDataProvider>");
  return ctx;
}
