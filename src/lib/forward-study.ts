import { tradeReturnR, type ResultTrade } from "./trade-result";

export const STUDY_FLOOR = 88;
export const STUDY_MIN_TRADES = 30;
export interface StudyBinding { id: string; broker_connection_id: string; status: string }

/** Unknown or changed accounts fail closed, regardless of labels supplied by the browser. */
export function studyExecutionBlock(study: StudyBinding, input: {
  connectionId: string | null; brokerId: string | null; environment: string | null;
  brokerIsDemo: boolean | null; tradingMode: string; requestedStudyId?: string | null;
}): string | null {
  if (study.status !== "active") return "Forward study is paused; new automatic entries are blocked.";
  if (input.tradingMode !== "live") return "Forward study requires broker-demo mode, not paper trading.";
  if (input.connectionId !== study.broker_connection_id || input.brokerId !== "oanda") return "Forward study account changed; restore the pinned OANDA account.";
  if (input.environment !== "oanda_practice" || input.brokerIsDemo !== true) return "Forward study requires a verified OANDA practice account.";
  if (input.requestedStudyId !== study.id) return "Only the study scheduler may open automatic entries during this study.";
  return null;
}

export function studyStats(trades: (ResultTrade & { status: string; pnl: unknown })[]) {
  const closed = trades.filter((trade) => trade.status === "closed" && trade.pnl != null && Number.isFinite(Number(trade.pnl)));
  const results = closed.map(tradeReturnR).filter((r): r is number => r != null);
  const wins = closed.filter((trade) => Number(trade.pnl) > 0).length;
  return {
    closed: closed.length, wins,
    winRate: closed.length ? wins / closed.length * 100 : null,
    netPnl: closed.reduce((sum, trade) => sum + Number(trade.pnl), 0),
    expectancyR: results.length ? results.reduce((sum, r) => sum + r, 0) / results.length : null,
    rSample: results.length,
    sufficientSample: results.length >= STUDY_MIN_TRADES,
  };
}