// Platform-wide service contracts.
//
// Every provider consumes ONE of these interfaces. Swapping the current
// mock/HTTP implementations for a Python/FastAPI backend means writing a new
// class that satisfies the interface — no component or provider changes.

import type { ConnectionStatus, MarketQuote } from "@/lib/market-data.types";
import type { TradePlan } from "@/lib/services/types";

export type { ConnectionStatus, MarketQuote };

export type MarketStatus = "open" | "closed" | "unknown";

export interface MarketSnapshot {
  quote: MarketQuote | null;
  status: ConnectionStatus;
  marketStatus: MarketStatus;
  lastUpdated: number | null;
  latencyMs: number | null;
  error: string | null;
  loading: boolean;
}

/** Market data source (HTTP polling today, WebSocket streaming later). */
export interface MarketDataService {
  readonly id: string;
  start(): void;
  stop(): void;
  refresh(): Promise<void>;
  subscribe(listener: (snapshot: MarketSnapshot) => void): () => void;
  getSnapshot(): MarketSnapshot;
}

export interface AIAnalysis {
  bias: "bullish" | "bearish" | "neutral" | null;
  confidence: number;
  market_structure: string | null;
  liquidity: string | null;
  order_block: string | null;
  fair_value_gap: string | null;
  session_context: string | null;
  explanation: string | null;
  invalidation: string | null;
  setup: TradePlan | Record<string, unknown> | null;
  strategy: string | null;
  generatedAt: number;
}

export interface AIAnalysisService {
  analyze(input: { timeframe: string; price?: number; session?: string }): Promise<AIAnalysis>;
}

export interface BrokerAccount {
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  currency: string;
}

export interface BrokerPosition {
  id: string;
  symbol: string;
  direction: "BUY" | "SELL";
  volume: number;
  entry_price: number;
  current_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  pnl: number;
  opened_at: string;
  closed_at?: string | null;
}

export interface BrokerService {
  readonly name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getAccount(): Promise<BrokerAccount>;
  getOpenPositions(): Promise<BrokerPosition[]>;
  getClosedPositions(): Promise<BrokerPosition[]>;
  getPendingOrders(): Promise<BrokerPosition[]>;
}

export interface TradeExecutionService {
  submit(plan: TradePlan): Promise<{ id: string; broker_id?: string | null }>;
  close(id: string, price: number, reason: string): Promise<{ pnl: number }>;
  modify(id: string, patch: { stop_loss?: number; take_profit?: number }): Promise<void>;
}

export interface RiskLimits {
  maxDailyLossPct: number;
  maxWeeklyLossPct: number;
  maxOpenTrades: number;
  maxExposureLots: number;
  riskPerTradePct: number;
}

export interface RiskState extends RiskLimits {
  dailyLossPct: number;
  weeklyLossPct: number;
  openTrades: number;
  exposureLots: number;
  tradingEnabled: boolean;
  tradingPaused: boolean;
  breaches: string[];
}

export interface RiskEngine {
  evaluate(state: Omit<RiskState, "breaches" | "tradingEnabled">): RiskState;
}

export interface JournalEntry {
  id: string;
  symbol: string;
  direction: "BUY" | "SELL";
  entry_price: number;
  exit_price: number | null;
  pnl: number | null;
  status: string;
  opened_at: string;
  closed_at: string | null;
}

export interface TradeJournalService {
  list(): Promise<JournalEntry[]>;
}

export type NotificationLevel = "info" | "success" | "warning" | "error";

export interface AppNotification {
  id: string;
  level: NotificationLevel;
  title: string;
  detail?: string;
  ts: number;
}
