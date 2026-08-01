import { createContext, useContext, useState, type ReactNode } from "react";
import { useAutopilot } from "@/hooks/useAutopilot";

type AutopilotApi = ReturnType<typeof useAutopilot> & {
  timeframe: string;
  setTimeframe: (v: string) => void;
};

const Ctx = createContext<AutopilotApi | null>(null);

/**
 * Hosts the autonomous trading engine at app level so it keeps running
 * (and keeps managing open positions) while the user browses other pages.
 * The floating widget and the Autopilot page are two views of this one engine.
 */
export function AutopilotProvider({ children }: { children: ReactNode }) {
  const [timeframe, setTimeframe] = useState<string>("15");
  const engine = useAutopilot({ timeframe });

  return (
    <Ctx.Provider value={{ ...engine, timeframe, setTimeframe }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAutopilotContext(): AutopilotApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAutopilotContext must be used inside <AutopilotProvider>");
  return ctx;
}
