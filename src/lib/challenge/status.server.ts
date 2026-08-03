// Server-only challenge status computation, shared by the app's server
// function and the scheduled tick so both enforce identical funded-account
// rules. Logic moved verbatim from challenge.functions.ts.

import { challengeDayKey, evaluateChallenge, rulesFromProfile, type ChallengeDay } from "@/lib/challenge/engine";

export async function computeChallengeStatus(
  supabase: any,
  userId: string,
  id?: string | null,
) {
  let query = supabase.from("challenge_profiles").select("*").eq("user_id", userId);
  query = id ? query.eq("id", id) : query.eq("status", "active");
  const { data: profiles, error: pErr } = await query.order("created_at", { ascending: false }).limit(1);
  if (pErr) throw new Error(pErr.message);
  const profile = profiles?.[0] ?? null;
  if (!profile) return { profile: null, status: null, days: [] as ChallengeDay[] };

  const rules = rulesFromProfile(profile);

  const [{ data: trades }, { data: acct }] = await Promise.all([
    supabase.from("trades")
      .select("pnl, status, lot_size, closed_at, opened_at")
      .eq("user_id", userId)
      .gte("opened_at", new Date(rules.start_at).toISOString()),
    supabase.from("paper_account").select("*").eq("user_id", userId).maybeSingle(),
  ]);

  const all = trades ?? [];
  const closed = all
    .filter((t: any) => t.status === "closed" && t.pnl != null && t.closed_at)
    .sort((a: any, b: any) => new Date(a.closed_at).getTime() - new Date(b.closed_at).getTime());
  const openLots = all.filter((t: any) => t.status === "open")
    .reduce((a: number, t: any) => a + Number(t.lot_size ?? 0), 0);

  // Rebuild the equity curve day by day, anchored to the reset hour.
  const dayMap = new Map<string, ChallengeDay>();
  let running = rules.start_balance;
  let peakEquity = rules.start_balance;
  let peakEodBalance = rules.start_balance;
  for (const t of closed) {
    const ts = new Date(t.closed_at).getTime();
    const key = challengeDayKey(ts, rules.daily_reset_utc_hour);
    let d = dayMap.get(key);
    if (!d) {
      d = { day: key, pnl: 0, trades: 0, start_equity: running, low_equity: running };
      dayMap.set(key, d);
    }
    running += Number(t.pnl);
    d.pnl += Number(t.pnl);
    d.trades += 1;
    d.low_equity = Math.min(d.low_equity, running);
    peakEquity = Math.max(peakEquity, running);
  }
  const days = [...dayMap.values()].sort((a, b) => a.day.localeCompare(b.day));
  for (const d of days) peakEodBalance = Math.max(peakEodBalance, d.start_equity + d.pnl);

  const todayKey = challengeDayKey(Date.now(), rules.daily_reset_utc_hour);
  const today = dayMap.get(todayKey);
  const dayStartEquity = today?.start_equity ?? running;

  // Live equity: prefer the paper account, fall back to the rebuilt curve.
  const equity = Number(acct?.equity ?? running) || running;
  const balance = Number(acct?.balance ?? running) || running;

  const wins = closed.filter((t: any) => Number(t.pnl) > 0);
  const losses = closed.filter((t: any) => Number(t.pnl) < 0);
  const stats = {
    closedTrades: closed.length,
    winRate: closed.length ? (wins.length / closed.length) * 100 : 0,
    avgWin: wins.length ? wins.reduce((a: number, t: any) => a + Number(t.pnl), 0) / wins.length : 0,
    avgLoss: losses.length ? losses.reduce((a: number, t: any) => a + Number(t.pnl), 0) / losses.length : 0,
  };

  const status = evaluateChallenge({
    now: Date.now(),
    rules,
    balance,
    equity,
    dayStartEquity,
    peakEquity: Math.max(peakEquity, equity),
    peakEodBalance,
    days,
    openLots,
    minutesToHighImpactNews: null,
    minutesToSessionClose: null,
    weekendClose: false,
    stats,
  });

  // Persist the recent daily history (bounded) for the analytics view.
  const recent = days.slice(-30);
  if (recent.length) {
    await supabase.from("challenge_daily_stats").upsert(
      recent.map((d) => ({
        user_id: userId,
        profile_id: profile.id,
        day: d.day,
        start_equity: d.start_equity,
        peak_equity: Math.max(d.start_equity, d.start_equity + d.pnl),
        low_equity: d.low_equity,
        end_equity: d.start_equity + d.pnl,
        pnl: d.pnl,
        trades: d.trades,
      })),
      { onConflict: "profile_id,day" },
    );
  }

  return { profile, status, days };
}
