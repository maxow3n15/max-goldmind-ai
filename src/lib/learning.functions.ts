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
    const byEnvironment = summarise(rows, (t) => t.environment ?? null);

    const withRate = (b: Bucket[]) =>
      b.map((x) => ({ ...x, win_rate: x.trades ? Math.round((x.wins / x.trades) * 100) : 0 }));

    const best = withRate(byMacro).filter((b) => b.trades >= 2)[0] ?? null;
    const worst = [...withRate(byMacro).filter((b) => b.trades >= 2)].pop() ?? null;

    const envRated = withRate(byEnvironment);
    const bestEnv = envRated.filter((b) => b.trades >= 2)[0] ?? null;
    const worstEnv = [...envRated.filter((b) => b.trades >= 2)].pop() ?? null;

    return {
      total_closed: rows.length,
      win_rate: rows.length ? Math.round((wins / rows.length) * 100) : 0,
      net_pnl: rows.reduce((a: number, t: any) => a + Number(t.pnl), 0),
      confidence_bands: withRate(bands),
      by_session: withRate(bySession),
      by_timeframe: withRate(byTimeframe),
      by_macro: withRate(byMacro),
      by_direction: withRate(byDirection),
      by_environment: envRated,
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
        bestEnv
          ? `Strongest market environment: ${bestEnv.key} — ${bestEnv.win_rate}% win rate over ${bestEnv.trades} trades.`
          : "Not enough closed trades yet to rank market environments (need 2+ per environment).",
        worstEnv && worstEnv !== bestEnv
          ? `Weakest market environment: ${worstEnv.key} — ${worstEnv.win_rate}% win rate over ${worstEnv.trades} trades.`
          : null,
      ].filter(Boolean) as string[],
    };
  });

/**
 * No-trade intelligence: what the engine declined, and why.
 *
 * Counts and reasons only — deliberately no "money saved" figure, because
 * the counterfactual outcome of a trade that was never taken is unknowable.
 */
export const getNoTradeInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
    const { data, error } = await context.supabase
      .from("decision_logs")
      .select("outcome, blockers, environment, decided_at")
      .eq("user_id", context.userId)
      .gte("decided_at", since)
      .order("decided_at", { ascending: false })
      .limit(2000);
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    const rejected = rows.filter((r: any) => r.outcome === "rejected");

    const blockerCounts = new Map<string, number>();
    const envCounts = new Map<string, number>();
    for (const r of rejected) {
      const blockers: string[] = Array.isArray(r.blockers) ? (r.blockers as string[]) : [];
      // Group on the primary (first) blocker — the reason the cycle stopped.
      const primary = blockers[0];
      if (primary) blockerCounts.set(primary, (blockerCounts.get(primary) ?? 0) + 1);
      const env = r.environment as string | null;
      if (env) envCounts.set(env, (envCounts.get(env) ?? 0) + 1);
    }


    const toList = (m: Map<string, number>) =>
      [...m.entries()]
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count);

    const topBlockers = toList(blockerCounts).slice(0, 10);

    return {
      window_days: 30,
      cycles_logged: rows.length,
      rejected_count: rejected.length,
      executed_count: rows.filter((r: any) => r.outcome === "accepted").length,
      rejection_rate: rows.length ? Math.round((rejected.length / rows.length) * 100) : 0,
      top_blockers: topBlockers,
      by_environment: toList(envCounts),
      notes:
        rows.length < 20
          ? ["Not enough decision cycles logged yet to draw conclusions — keep the engine running."]
          : topBlockers.length
            ? [`Most common reason for standing down: ${topBlockers[0].key} (${topBlockers[0].count} cycles).`]
            : ["No rejection reasons recorded in this window."],
    };
  });

