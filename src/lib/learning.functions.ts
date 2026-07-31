import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

interface Bucket { key: string; trades: number; wins: number; pnl: number }

function summarise(rows: any[], keyFn: (t: any) => string | null): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const t of rows) {
    const key = keyFn(t);
    if (!key) continue;
    const b = map.get(key) ?? { key, trades: 0, wins: 0, pnl: 0 };
    b.trades += 1;
    if (Number(t.pnl) > 0) b.wins += 1;
    b.pnl += Number(t.pnl ?? 0);
    map.set(key, b);
  }
  return [...map.values()].sort((a, b) => b.pnl - a.pnl);
}

/**
 * Self-improvement layer: mines the user's own closed trades for which
 * setups, sessions, macro environments and confidence bands actually work.
 * Pure statistics over stored outcomes — nothing is fabricated.
 */
export const getLearningInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("trades")
      .select("*")
      .eq("user_id", context.userId)
      .eq("status", "closed")
      .order("closed_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    const rows = (data ?? []).filter((t: any) => t.pnl != null);
    const wins = rows.filter((t: any) => Number(t.pnl) > 0).length;

    const macroOf = (t: any) => {
      const m = (t.ai_analysis as any)?.macro;
      return m ? `${m.gold_bias} gold · USD ${m.dollar_strength} · ${m.rate_outlook}` : null;
    };

    const bands = summarise(rows, (t) => {
      const c = Number(t.confidence ?? 0);
      if (!c) return null;
      if (c >= 95) return "95-100%";
      if (c >= 90) return "90-94%";
      if (c >= 85) return "85-89%";
      return "<85%";
    });

    const bySession = summarise(rows, (t) => t.session ?? null);
    const byTimeframe = summarise(rows, (t) => t.timeframe ?? null);
    const byMacro = summarise(rows, macroOf);
    const byDirection = summarise(rows, (t) => t.direction ?? null);

    const withRate = (b: Bucket[]) =>
      b.map((x) => ({ ...x, win_rate: x.trades ? Math.round((x.wins / x.trades) * 100) : 0 }));

    const best = withRate(byMacro).filter((b) => b.trades >= 2)[0] ?? null;
    const worst = [...withRate(byMacro).filter((b) => b.trades >= 2)].pop() ?? null;

    return {
      total_closed: rows.length,
      win_rate: rows.length ? Math.round((wins / rows.length) * 100) : 0,
      net_pnl: rows.reduce((a: number, t: any) => a + Number(t.pnl), 0),
      confidence_bands: withRate(bands),
      by_session: withRate(bySession),
      by_timeframe: withRate(byTimeframe),
      by_macro: withRate(byMacro),
      by_direction: withRate(byDirection),
      lessons: [
        best && best.trades >= 2
          ? `Best macro environment so far: ${best.key} — ${best.win_rate}% win rate over ${best.trades} trades.`
          : "Not enough closed trades yet to rank macro environments (need 2+ per environment).",
        worst && worst !== best && worst.trades >= 2
          ? `Weakest macro environment: ${worst.key} — ${worst.win_rate}% win rate. Raise the confidence bar in this regime.`
          : null,
        withRate(bands)[0] && withRate(bands)[0].trades >= 2
          ? `Highest-yield confidence band: ${withRate(bands)[0].key} (${withRate(bands)[0].win_rate}% win rate).`
          : null,
      ].filter(Boolean) as string[],
    };
  });
