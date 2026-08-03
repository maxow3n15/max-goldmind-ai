import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { challengeDayKey, evaluateChallenge, rulesFromProfile, type ChallengeDay } from "@/lib/challenge/engine";

const ProfileInput = z.object({
  id: z.string().uuid().nullable().optional(),
  broker_connection_id: z.string().uuid().nullable().optional(),
  label: z.string().trim().min(1).max(80),
  provider: z.string().trim().min(1).max(60),
  preset_key: z.string().trim().min(1).max(40),
  phase: z.enum(["evaluation_1", "evaluation_2", "funded"]),
  account_size: z.number().positive().max(10_000_000),
  currency: z.string().trim().min(1).max(8).default("USD"),
  profit_target_pct: z.number().min(0).max(100),
  daily_loss_limit_pct: z.number().min(0.1).max(100),
  max_drawdown_pct: z.number().min(0.1).max(100),
  drawdown_type: z.enum(["static", "trailing", "eod_trailing"]),
  drawdown_basis: z.enum(["equity", "balance"]),
  daily_loss_basis: z.enum(["balance", "equity"]),
  consistency_rule_pct: z.number().min(1).max(100).nullable().optional(),
  min_trading_days: z.number().int().min(0).max(365),
  max_trading_days: z.number().int().min(1).max(365).nullable().optional(),
  news_restriction_minutes: z.number().int().min(0).max(240),
  weekend_holding_allowed: z.boolean(),
  overnight_holding_allowed: z.boolean(),
  max_lot_size: z.number().positive().max(100).nullable().optional(),
  daily_reset_utc_hour: z.number().int().min(0).max(23),
  start_balance: z.number().positive().max(10_000_000),
  status: z.enum(["active", "passed", "failed", "paused"]).default("active"),
  auto_enforce: z.boolean().default(true),
  safety_buffer_pct: z.number().min(0).max(60).default(20),
  notes: z.string().max(2000).nullable().optional(),
});

export const listChallengeProfiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("challenge_profiles")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const saveChallengeProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ProfileInput.parse(d))
  .handler(async ({ data, context }) => {
    const { id, ...rest } = data;
    const row = { ...rest, user_id: context.userId };
    if (id) {
      const { data: updated, error } = await context.supabase
        .from("challenge_profiles").update(row)
        .eq("id", id).eq("user_id", context.userId).select().single();
      if (error) throw new Error(error.message);
      return updated;
    }
    const { data: created, error } = await context.supabase
      .from("challenge_profiles").insert(row).select().single();
    if (error) throw new Error(error.message);
    return created;
  });

export const deleteChallengeProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("challenge_profiles").delete().eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const StatusInput = z.object({ id: z.string().uuid().nullable().optional() });

/**
 * Full compliance read for one challenge account: rebuilds the equity
 * timeline from stored trades, anchors every day to the provider's reset
 * hour, evaluates each objective, and persists the daily statistics so the
 * history survives even if trades are later archived.
 */
export const getChallengeStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => StatusInput.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("challenge_profiles").select("*").eq("user_id", context.userId);
    query = data.id ? query.eq("id", data.id) : query.eq("status", "active");
    const { data: profiles, error: pErr } = await query.order("created_at", { ascending: false }).limit(1);
    if (pErr) throw new Error(pErr.message);
    const profile = profiles?.[0] ?? null;
    if (!profile) return { profile: null, status: null, days: [] as ChallengeDay[] };

    const rules = rulesFromProfile(profile);

    const [{ data: trades }, { data: acct }] = await Promise.all([
      context.supabase.from("trades")
        .select("pnl, status, lot_size, closed_at, opened_at")
        .eq("user_id", context.userId)
        .gte("opened_at", new Date(rules.start_at).toISOString()),
      context.supabase.from("paper_account").select("*").eq("user_id", context.userId).maybeSingle(),
    ]);

    const all = trades ?? [];
    const closed = all
      .filter((t) => t.status === "closed" && t.pnl != null && t.closed_at)
      .sort((a, b) => new Date(a.closed_at!).getTime() - new Date(b.closed_at!).getTime());
    const openLots = all.filter((t) => t.status === "open")
      .reduce((a, t) => a + Number(t.lot_size ?? 0), 0);

    // Rebuild the equity curve day by day, anchored to the reset hour.
    const dayMap = new Map<string, ChallengeDay>();
    let running = rules.start_balance;
    let peakEquity = rules.start_balance;
    let peakEodBalance = rules.start_balance;
    for (const t of closed) {
      const ts = new Date(t.closed_at!).getTime();
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

    const wins = closed.filter((t) => Number(t.pnl) > 0);
    const losses = closed.filter((t) => Number(t.pnl) < 0);
    const stats = {
      closedTrades: closed.length,
      winRate: closed.length ? (wins.length / closed.length) * 100 : 0,
      avgWin: wins.length ? wins.reduce((a, t) => a + Number(t.pnl), 0) / wins.length : 0,
      avgLoss: losses.length ? losses.reduce((a, t) => a + Number(t.pnl), 0) / losses.length : 0,
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
      await context.supabase.from("challenge_daily_stats").upsert(
        recent.map((d) => ({
          user_id: context.userId,
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
  });
