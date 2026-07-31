// Trading session intelligence.
//
// Gold behaves differently through the day. These are pure statistics over
// the trader's OWN closed trades — the engine favours historically strong
// sessions without ever forbidding trades outside them.

import type { SessionReport, SessionStat } from "./quant.types";

export const SESSIONS = ["Asian", "London", "London/NY Overlap", "New York", "After hours"] as const;

/** Session label for a UTC timestamp. */
export function sessionForDate(d: Date): string {
  const h = d.getUTCHours();
  if (h >= 13 && h < 16) return "London/NY Overlap";
  if (h >= 7 && h < 13) return "London";
  if (h >= 16 && h < 21) return "New York";
  if (h >= 23 || h < 7) return "Asian";
  return "After hours";
}

interface TradeRow {
  status?: string | null;
  pnl?: number | string | null;
  session?: string | null;
  opened_at?: string | null;
  closed_at?: string | null;
  entry_price?: number | string | null;
  stop_loss?: number | string | null;
  take_profit_1?: number | string | null;
}

export function analyseSessions(trades: TradeRow[], currentSession: string): SessionReport {
  const rows = (Array.isArray(trades) ? trades : []).filter(
    (t) => t.status === "closed" && t.pnl != null && t.opened_at,
  );

  const map = new Map<string, { trades: number; wins: number; pnl: number; rr: number[]; mins: number[] }>();
  for (const t of rows) {
    const key = t.session || sessionForDate(new Date(t.opened_at as string));
    const b = map.get(key) ?? { trades: 0, wins: 0, pnl: 0, rr: [], mins: [] };
    b.trades += 1;
    const pnl = Number(t.pnl);
    if (pnl > 0) b.wins += 1;
    b.pnl += pnl;
    const entry = Number(t.entry_price), sl = Number(t.stop_loss), tp = Number(t.take_profit_1);
    if (Number.isFinite(entry) && Number.isFinite(sl) && Number.isFinite(tp) && Math.abs(entry - sl) > 0) {
      b.rr.push(Math.abs(tp - entry) / Math.abs(entry - sl));
    }
    if (t.closed_at) {
      const mins = (new Date(t.closed_at).getTime() - new Date(t.opened_at as string).getTime()) / 60000;
      if (Number.isFinite(mins) && mins >= 0) b.mins.push(mins);
    }
    map.set(key, b);
  }

  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const stats: SessionStat[] = [...map.entries()].map(([session, b]) => ({
    session,
    trades: b.trades,
    win_rate: b.trades ? Math.round((b.wins / b.trades) * 100) : 0,
    avg_rr: +avg(b.rr).toFixed(2),
    avg_duration_minutes: Math.round(avg(b.mins)),
    net_pnl: +b.pnl.toFixed(2),
  })).sort((a, b) => b.net_pnl - a.net_pnl);

  const currentStat = stats.find((s) => s.session === currentSession) ?? null;
  const notes: string[] = [`Current session: ${currentSession}`];
  let score = 55; // slight positive default so a fresh account still trades

  // Baseline structural edge: the London and NY overlap carries the most
  // institutional flow in gold.
  if (currentSession === "London/NY Overlap") { score += 12; notes.push("Overlap session — peak gold liquidity"); }
  else if (currentSession === "London" || currentSession === "New York") { score += 6; notes.push("Major session — good liquidity"); }
  else if (currentSession === "Asian") { score -= 6; notes.push("Asian session — thinner liquidity, ranges dominate"); }

  if (currentStat && currentStat.trades >= 3) {
    // Own history overrides the structural prior once there is a sample.
    const edge = (currentStat.win_rate - 50) * 0.6;
    score += Math.max(-20, Math.min(20, edge));
    notes.push(`Your history in ${currentSession}: ${currentStat.win_rate}% win rate over ${currentStat.trades} trades, avg R:R ${currentStat.avg_rr}, avg hold ${currentStat.avg_duration_minutes}m`);
  } else {
    notes.push("Not enough closed trades in this session yet — using structural liquidity profile");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score, notes,
    current: currentSession,
    stats,
    current_stat: currentStat,
    favoured: score >= 60,
  };
}
