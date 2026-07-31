// Fundamental / macro intelligence contracts.
//
// The macro layer is deliberately separated from technical analysis so the
// two can be scored independently and only combined at the final gate.

export type GoldDirection = "bullish" | "bearish" | "neutral";
export type DollarStrength = "strong" | "neutral" | "weak";
export type RateOutlook = "hawkish" | "neutral" | "dovish";
export type RiskEnvironment = "risk-on" | "risk-off" | "mixed";
export type Impact = "high" | "medium" | "low";

export interface NewsItem {
  id: string;
  title: string;
  source: string;
  url: string;
  published_at: string;
  category:
    | "central-bank"
    | "economic-data"
    | "market"
    | "geopolitical"
    | "other";
}

export interface ScoredHeadline {
  title: string;
  source: string;
  url?: string;
  impact: Impact;
  gold_effect: GoldDirection;
  reason: string;
}

export interface EconEvent {
  name: string;
  when: string;            // ISO or human string as reported by the model
  hours_away: number | null;
  impact: Impact;
  expectation: string | null;
  priced_in: boolean;
}

/** The full macro picture used by the confidence + safety engines. */
export interface MacroReport {
  generated_at: number;
  news_score: number;              // 0..100 — 50 = neutral, >50 bullish gold
  gold_bias: GoldDirection;
  dollar_strength: DollarStrength;
  rate_outlook: RateOutlook;
  risk_environment: RiskEnvironment;
  yields: "rising" | "falling" | "flat";
  geopolitical_risk: Impact;
  sentiment_score: number;         // 0..100 institutional / safe-haven demand
  summary: string;                 // AI explanation of current conditions
  bullish_drivers: string[];
  bearish_drivers: string[];
  headlines: ScoredHeadline[];
  upcoming_events: EconEvent[];
  blackout: {
    active: boolean;
    reason: string | null;
    event: string | null;
    minutes_away: number | null;
  };
  post_event_wait: boolean;        // true right after a high-impact release
  degraded?: boolean;              // true when the feed/model failed
}

/** Four independent pillars plus the blended final confidence. */
export interface CompositeConfidence {
  technical: number;
  news: number;
  sentiment: number;
  risk: number;
  final: number;
  aligned: boolean;                // news direction agrees with the setup
  gates: { key: string; label: string; passed: boolean; detail?: string }[];
  passed: boolean;
  blockers: string[];
}

export interface TradeExplanationReport {
  direction: "BUY" | "SELL";
  confidence: number;
  entry: number;
  stop_loss: number;
  take_profit: number;
  risk_reward: number;
  technical_confirmations: string[];
  news_confirmations: string[];
  sentiment: string;
  risks: string[];
  entry_reason: string;
}
