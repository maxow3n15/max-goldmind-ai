import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PollingMarketDataService } from "@/services/market-data.service";
import { setDiagnostics } from "@/lib/platform-context";
import type { MarketDataService, MarketSnapshot } from "@/types/platform";

interface MarketDataContextValue extends MarketSnapshot {
  service: MarketDataService;
  refresh: () => Promise<void>;
}

const Ctx = createContext<MarketDataContextValue | null>(null);

export function MarketDataProvider({
  children,
  service,
}: {
  children: ReactNode;
  service?: MarketDataService;
}) {
  const serviceRef = useRef<MarketDataService>(service ?? new PollingMarketDataService());
  const [snapshot, setSnapshot] = useState<MarketSnapshot>(() => serviceRef.current.getSnapshot());

  useEffect(() => {
    const svc = serviceRef.current;
    const unsub = svc.subscribe(setSnapshot);
    svc.start();
    return () => {
      unsub();
      svc.stop();
    };
  }, []);

  useEffect(() => {
    setDiagnostics({ marketStatus: `${snapshot.status}/${snapshot.marketStatus}` });
  }, [snapshot.status, snapshot.marketStatus]);

  const value = useMemo<MarketDataContextValue>(
    () => ({ ...snapshot, service: serviceRef.current, refresh: () => serviceRef.current.refresh() }),
    [snapshot],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMarketDataContext(): MarketDataContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useMarketDataContext must be used inside <MarketDataProvider>");
  return ctx;
}
