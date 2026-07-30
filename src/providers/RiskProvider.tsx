import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getUserSettings } from "@/lib/settings.functions";
import { useBroker } from "./BrokerProvider";
import type { RiskState } from "@/types/platform";

interface RiskContextValue extends RiskState {
  pauseTrading: (reason: string) => void;
  resumeTrading: () => void;
  pauseReason: string | null;
  canTrade: boolean;
}

const Ctx = createContext<RiskContextValue | null>(null);

export function RiskProvider({ children }: { children: ReactNode }) {
  const broker = useBroker();
  const settingsFn = useServerFn(getUserSettings);
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => settingsFn() });
  const [pauseReason, setPauseReason] = useState<string | null>(null);

  const s: any = settings.data ?? {};
  const value = useMemo<RiskContextValue>(() => {
    const limits = {
      maxDailyLossPct: Number(s.max_daily_loss ?? 3),
      maxWeeklyLossPct: Number(s.max_weekly_loss ?? 6),
      maxOpenTrades: Number(s.max_open_trades ?? 3),
      maxExposureLots: Number(s.max_exposure_lots ?? 1),
      riskPerTradePct: Math.min(Number(s.risk_per_trade ?? 0.5), 0.5),
    };

    const balance = broker.account.balance || 1;
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const weekStart = new Date(Date.now() - 7 * 864e5);
    const sumSince = (from: Date) =>
      broker.closedPositions
        .filter((p) => p.closed_at && new Date(p.closed_at) >= from)
        .reduce((a, p) => a + (p.pnl ?? 0), 0);

    const dailyLossPct = -Math.min(0, sumSince(dayStart)) / balance * 100;
    const weeklyLossPct = -Math.min(0, sumSince(weekStart)) / balance * 100;
    const openTrades = broker.openPositions.length;
    const exposureLots = broker.openPositions.reduce((a, p) => a + p.volume, 0);

    const breaches: string[] = [];
    if (dailyLossPct >= limits.maxDailyLossPct) breaches.push(`Daily loss ${dailyLossPct.toFixed(2)}% ≥ ${limits.maxDailyLossPct}%`);
    if (weeklyLossPct >= limits.maxWeeklyLossPct) breaches.push(`Weekly loss ${weeklyLossPct.toFixed(2)}% ≥ ${limits.maxWeeklyLossPct}%`);
    if (openTrades >= limits.maxOpenTrades) breaches.push(`Open trades ${openTrades} ≥ ${limits.maxOpenTrades}`);
    if (exposureLots > limits.maxExposureLots) breaches.push(`Exposure ${exposureLots.toFixed(2)} lots > ${limits.maxExposureLots}`);

    const tradingPaused = pauseReason != null;
    const tradingEnabled = breaches.length === 0 && !tradingPaused;

    return {
      ...limits,
      dailyLossPct, weeklyLossPct, openTrades, exposureLots,
      tradingEnabled, tradingPaused, breaches,
      pauseReason,
      canTrade: tradingEnabled,
      pauseTrading: (reason: string) => setPauseReason(reason),
      resumeTrading: () => setPauseReason(null),
    };
  }, [s, broker.account.balance, broker.openPositions, broker.closedPositions, pauseReason]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRisk(): RiskContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useRisk must be used inside <RiskProvider>");
  return ctx;
}
