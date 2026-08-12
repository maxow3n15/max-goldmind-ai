// Shared market data domain types. Kept client-safe (no server imports)
// so both frontend hooks and server routes/functions can import.

export type ConnectionStatus = "connected" | "reconnecting" | "disconnected";

export interface MarketQuote {
  symbol: string;      // e.g. "XAUUSD"
  bid: number;
  ask: number;
  spread: number;      // ask - bid
  mid: number;         // (ask + bid) / 2
  timestamp: number;   // epoch ms (UTC) of last price update
  source: string;      // human label for the data provider
  /**
   * True when the quote was generated locally because no real feed was
   * reachable. Never set by a production feed; every trading path must
   * refuse to act on a simulated quote.
   */
  simulated?: boolean;
}


export interface MarketDataEnvelope {
  ok: boolean;
  quote?: MarketQuote;
  error?: string;
}

// Future trading-server payloads. Defined now so the frontend can consume
// them from a single service layer without refactors later.
export interface TradingSignal {
  id: string;
  symbol: string;
  direction: "BUY" | "SELL";
  entry: number;
  stop_loss: number;
  take_profit_1: number;
  take_profit_2?: number;
  take_profit_3?: number;
  confidence: number;
  issued_at: number;
}

export interface RemotePosition {
  id: string;
  symbol: string;
  direction: "BUY" | "SELL";
  volume: number;
  entry_price: number;
  current_price: number;
  pnl: number;
  opened_at: number;
}
