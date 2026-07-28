import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const OpenTradeInput = z.object({
  direction: z.enum(["BUY", "SELL"]),
  entry_price: z.number().positive(),
  stop_loss: z.number().positive(),
  take_profit_1: z.number().positive().nullable().optional(),
  take_profit_2: z.number().positive().nullable().optional(),
  take_profit_3: z.number().positive().nullable().optional(),
  lot_size: z.number().positive().max(100),
  confidence: z.number().min(0).max(100).optional(),
  timeframe: z.string().optional(),
  session: z.string().optional(),
  reason_entry: z.string().max(2000).optional(),
  ai_analysis: z.any().optional(),
});

export const openPaperTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => OpenTradeInput.parse(d))
  .handler(async ({ data, context }) => {
    const rr = data.take_profit_1
      ? Math.abs(data.take_profit_1 - data.entry_price) / Math.max(0.01, Math.abs(data.entry_price - data.stop_loss))
      : null;
    const { data: row, error } = await context.supabase.from("trades").insert({
      user_id: context.userId,
      symbol: "XAUUSD",
      direction: data.direction,
      entry_price: data.entry_price,
      stop_loss: data.stop_loss,
      take_profit_1: data.take_profit_1 ?? null,
      take_profit_2: data.take_profit_2 ?? null,
      take_profit_3: data.take_profit_3 ?? null,
      lot_size: data.lot_size,
      risk_reward: rr,
      confidence: data.confidence ?? null,
      timeframe: data.timeframe ?? null,
      session: data.session ?? null,
      reason_entry: data.reason_entry ?? null,
      ai_analysis: data.ai_analysis ?? null,
      mode: "paper",
      status: "open",
    }).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

const CloseTradeInput = z.object({
  id: z.string().uuid(),
  exit_price: z.number().positive(),
  reason_exit: z.string().max(1000).optional(),
});

export const closePaperTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CloseTradeInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: trade, error: fErr } = await context.supabase
      .from("trades").select("*").eq("id", data.id).eq("user_id", context.userId).single();
    if (fErr || !trade) throw new Error("Trade not found");

    // Gold: $1 per pip per 0.01 lot approximation
    const priceDiff = trade.direction === "BUY"
      ? data.exit_price - Number(trade.entry_price)
      : Number(trade.entry_price) - data.exit_price;
    const pnl = priceDiff * 100 * Number(trade.lot_size);

    const { error: uErr } = await context.supabase.from("trades").update({
      status: "closed",
      exit_price: data.exit_price,
      reason_exit: data.reason_exit ?? null,
      pnl,
      closed_at: new Date().toISOString(),
    }).eq("id", data.id);
    if (uErr) throw new Error(uErr.message);

    // Update paper account
    const { data: acct } = await context.supabase
      .from("paper_account").select("*").eq("user_id", context.userId).single();
    if (acct) {
      const newBal = Number(acct.balance) + pnl;
      await context.supabase.from("paper_account").update({
        balance: newBal, equity: newBal, free_margin: newBal, updated_at: new Date().toISOString(),
      }).eq("user_id", context.userId);
    }
    return { pnl };
  });

export const listTrades = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("trades").select("*")
      .eq("user_id", context.userId)
      .order("opened_at", { ascending: false })
      .limit(100);
    return data ?? [];
  });

export const getAccountSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [{ data: acct }, { data: trades }] = await Promise.all([
      context.supabase.from("paper_account").select("*").eq("user_id", context.userId).maybeSingle(),
      context.supabase.from("trades").select("pnl, status, opened_at, closed_at").eq("user_id", context.userId),
    ]);
    const closed = (trades ?? []).filter((t) => t.status === "closed" && t.pnl != null);
    const open = (trades ?? []).filter((t) => t.status === "open");
    const now = new Date();
    const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
    const weekStart = new Date(now); weekStart.setUTCDate(now.getUTCDate() - 7);
    const monthStart = new Date(now); monthStart.setUTCDate(now.getUTCDate() - 30);
    const sumSince = (d: Date) => closed
      .filter((t) => t.closed_at && new Date(t.closed_at) >= d)
      .reduce((a, t) => a + Number(t.pnl), 0);
    const wins = closed.filter((t) => Number(t.pnl) > 0).length;
    return {
      account: acct ?? { balance: 10000, equity: 10000, free_margin: 10000, margin_used: 0 },
      open_count: open.length,
      closed_count: closed.length,
      daily_pnl: sumSince(dayStart),
      weekly_pnl: sumSince(weekStart),
      monthly_pnl: sumSince(monthStart),
      win_rate: closed.length ? (wins / closed.length) * 100 : 0,
    };
  });
