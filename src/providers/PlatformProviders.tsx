import type { ReactNode } from "react";
import { MarketDataProvider } from "./MarketDataProvider";
import { NotificationProvider } from "./NotificationProvider";
import { AIProvider } from "./AIProvider";
import { BrokerProvider } from "./BrokerProvider";
import { RiskProvider } from "./RiskProvider";

/** Single composition point for all global application providers. */
export function PlatformProviders({ children }: { children: ReactNode }) {
  return (
    <NotificationProvider>
      <MarketDataProvider>
        <BrokerProvider>
          <RiskProvider>
            <AIProvider>{children}</AIProvider>
          </RiskProvider>
        </BrokerProvider>
      </MarketDataProvider>
    </NotificationProvider>
  );
}

export { useMarketDataContext } from "./MarketDataProvider";
export { useNotifications } from "./NotificationProvider";
export { useAI, AI_CONFIDENCE_THRESHOLD } from "./AIProvider";
export { useBroker } from "./BrokerProvider";
export { useRisk } from "./RiskProvider";
