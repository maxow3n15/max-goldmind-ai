import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAccountSnapshot, listTrades } from "@/lib/trades.functions";
import { isTradingServerConfigured } from "@/lib/trading-server";
import { setDiagnostics } from "@/lib/platform-context";
import { useMarketDataContext } from "./MarketDataProvider";
import type { BrokerAccount, BrokerPosition } from "@/types/platform";

export type BrokerConnection = "connected" | "mock" | "disconnected";

interface BrokerContextValue {
  name: string;
  connection: BrokerConnection;
  tradingMode: "paper" | "live";
  account: BrokerAccount;
  openPositions: BrokerPosition[];
  closedPositions: BrokerPosition[];
  pendingOrders: BrokerPosition[];
  loading: boolean;
  refresh: () => void;
}

const EMPTY_ACCOUNT: BrokerAccount = {
  balance: 0, equity: 0, margin: 0, freeMargin: 0, currency: "USD",
};

const Ctx = createContext<BrokerContextValue | null>(null);

function toPosition(t: any, price: number | null): BrokerPosition {
  const entry = Number(t.entry_price);
  const dir = t.direction as "BUY" | "SELL";
  const live = price ?? Number(t.exit_price ?? entry);
  const pnl = t.pnl != null
    ? Number(t.pnl)
    : (dir === "BUY" ? live - entry : entry - live) * 100 * Number(t.lot_size ?? 0);
  return {
    id: t.id,
    symbol: t.symbol ?? "XAUUSD",
    direction: dir,
    volume: Number(t.lot_size ?? 0),
    entry_price: entry,
    current_price: price,
    stop_loss: t.stop_loss != null ? Number(t.stop_loss) : null,
    take_profit: t.take_profit_1 != null ? Number(t.take_profit_1) : null,
    pnl,
    opened_at: t.opened_at,
    closed_at: t.closed_at ?? null,
  };
}

export function BrokerProvider({ children }: { children: ReactNode }) {
  const market = useMarketDataContext();
  const snapFn = useServerFn(getAccountSnapshot);
  const tradesFn = useServerFn(listTrades);

  const snapshot = useQuery({ queryKey: ["snapshot"], queryFn: () => snapFn(), refetchInterval: 15_000 });
  const trades = useQuery({ queryKey: ["trades"], queryFn: () => tradesFn(), refetchInterval: 10_000 });

  const rows: any[] = Array.isArray(trades.data) ? trades.data : [];
  const price = market.quote?.mid ?? null;

  const openPositions = useMemo(
    () => rows.filter((t) => t.status === "open").map((t) => toPosition(t, price)),
    [rows, price],
  );
  const closedPositions = useMemo(
    () => rows.filter((t) => t.status === "closed").map((t) => toPosition(t, null)),
    [rows],
  );
  const pendingOrders = useMemo(
    () => rows.filter((t) => t.status === "pending").map((t) => toPosition(t, price)),
    [rows, price],
  );

  const acct: any = (snapshot.data as any)?.account ?? null;
  const account: BrokerAccount = acct
    ? {
        balance: Number(acct.balance ?? 0),
        equity: Number(acct.equity ?? acct.balance ?? 0) + openPositions.reduce((a, p) => a + p.pnl, 0),
        margin: Number(acct.margin_used ?? 0),
        freeMargin: Number(acct.free_margin ?? acct.balance ?? 0),
        currency: "USD",
      }
    : EMPTY_ACCOUNT;

  // No real broker yet: the paper engine is a mocked-but-persistent broker.
  const connection: BrokerConnection = snapshot.isError
    ? "disconnected"
    : isTradingServerConfigured()
      ? "connected"
      : "mock";

  useEffect(() => {
    setDiagnostics({
      brokerStatus: connection,
      currentTrade: openPositions[0] ? `${openPositions[0].direction} ${openPositions[0].volume} @ ${openPositions[0].entry_price}` : null,
    });
  }, [connection, openPositions]);

  const value = useMemo<BrokerContextValue>(() => ({
    name: isTradingServerConfigured() ? "External Trading Server" : "GoldMind Paper Broker",
    connection,
    tradingMode: "paper",
    account,
    openPositions,
    closedPositions,
    pendingOrders,
    loading: snapshot.isLoading || trades.isLoading,
    refresh: () => { void snapshot.refetch(); void trades.refetch(); },
  }), [connection, account, openPositions, closedPositions, pendingOrders, snapshot, trades]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBroker(): BrokerContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useBroker must be used inside <BrokerProvider>");
  return ctx;
}
