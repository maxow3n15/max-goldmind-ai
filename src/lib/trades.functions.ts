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
  /** Who initiated the trade: the engine, or the user. */
  source: z.enum(["auto", "manual"]).default("auto"),
  /** Market-environment label at open time (services/environment.ts). */
  environment: z.string().max(200).nullable().optional(),
  /**
   * Idempotency key. A retry, a double-click or a re-mounted engine that
   * replays the same order must never open a second position.
   */
  client_order_id: z.string().min(8).max(120).optional(),
  /** Signal lifetime, UTC ms. An expired plan is refused outright. */
  issued_at: z.number().int().positive().optional(),
  expires_at: z.number().int().positive().optional(),
});

export const openPaperTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => OpenTradeInput.parse(d))
  .handler(async ({ data, context }) => {
    // Idempotency: if this exact order was already accepted, return it
    // rather than opening a duplicate position.
    if (data.client_order_id) {
      const { data: existing } = await context.supabase
        .from("trades").select("*")
        .eq("user_id", context.userId)
        .eq("client_order_id", data.client_order_id)
        .maybeSingle();
      if (existing) return existing;
    }

    // Server is authoritative: re-derive the gates from the order plus a fresh
    // server-side price. The caller's own verdict is never trusted.
    const { checkAccountProtection } = await import("@/lib/trades.server");
    const guard = await checkAccountProtection(context.supabase, context.userId, "paper");
    if (!guard.ok) throw new Error(guard.reason ?? "Blocked by account protection");

    // Signal expiry: a setup reasoned about minutes ago is not the setup the
    // market is offering now.
    const { isExpired, modelFill } = await import("@/lib/services/signal");
    if (isExpired(data.expires_at)) {
      throw new Error("Execution refused — signal expired before it could be filled.");
    }

    const { revalidateOrder } = await import("@/lib/services/execution-guard.server");
    const revalidation = await revalidateOrder(
      {
        direction: data.direction,
        entry_price: data.entry_price,
        stop_loss: data.stop_loss,
        take_profit_1: data.take_profit_1 ?? null,
        confidence: data.confidence ?? null,
      },
      guard.settings,
    );
    if (!revalidation.ok) throw new Error(`Execution refused — ${revalidation.reason}`);

    // Paper trading fills the way a broker would: cross the spread, then take
    // assumed adverse slippage. The idealised plan price is kept for audit.
    const fill =
      revalidation.spot != null
        ? modelFill({
            direction: data.direction,
            mid: revalidation.spot,
            spread: revalidation.spread ?? 0.3,
          })
        : { price: data.entry_price, cost: 0 };

    const entryPrice = fill.price;
    const rr = data.take_profit_1
      ? Math.abs(data.take_profit_1 - entryPrice) / Math.max(0.01, Math.abs(entryPrice - data.stop_loss))
      : null;
    const { data: row, error } = await context.supabase.from("trades").insert({
      user_id: context.userId,
      symbol: "XAUUSD",
      direction: data.direction,
      entry_price: entryPrice,
      stop_loss: data.stop_loss,
      initial_stop_loss: data.stop_loss,
      take_profit_1: data.take_profit_1 ?? null,
      take_profit_2: data.take_profit_2 ?? null,
      take_profit_3: data.take_profit_3 ?? null,
      lot_size: data.lot_size,
      risk_reward: rr,
      confidence: data.confidence ?? null,
      timeframe: data.timeframe ?? null,
      session: data.session ?? null,
      reason_entry: data.reason_entry ?? null,
      ai_analysis: {
        ...(typeof data.ai_analysis === "object" && data.ai_analysis ? data.ai_analysis : {}),
        execution: {
          planned_entry: data.entry_price,
          fill_price: entryPrice,
          fill_cost_usd: fill.cost,
          server_spot: revalidation.spot ?? null,
          server_spread: revalidation.spread ?? null,
          issued_at: data.issued_at ?? null,
          expires_at: data.expires_at ?? null,
          model: "paper-fill: spread crossed + assumed slippage",
        },
      },
      client_order_id: data.client_order_id ?? null,
      source: data.source,
      environment: data.environment ?? null,
      mode: "paper",
      status: "open",
    }).select().single();

    if (error) {
      // A concurrent submission won the race — return the winner.
      if (data.client_order_id && /duplicate key|unique/i.test(error.message)) {
        const { data: existing } = await context.supabase
          .from("trades").select("*")
          .eq("user_id", context.userId)
          .eq("client_order_id", data.client_order_id)
          .maybeSingle();
        if (existing) return existing;
      }
      throw new Error(error.message);
    }
    return row;
  });



const ManualTradeInput = z.object({
  direction: z.enum(["BUY", "SELL"]),
  entry_price: z.number().positive(),
  stop_loss: z.number().positive(),
  take_profit_1: z.number().positive().nullable().optional(),
  take_profit_2: z.number().positive().nullable().optional(),
  take_profit_3: z.number().positive().nullable().optional(),
  lot_size: z.number().min(0.01).max(100),
  timeframe: z.string().optional(),
  session: z.string().optional(),
  note: z.string().max(500).optional(),
  environment: z.string().max(200).nullable().optional(),
});

/**
 * User-initiated paper trade.
 *
 * Passes the account-protection checks that apply to any order (kill switch,
 * max open trades) but skips the AI gates — there is no AI setup behind a
 * manual entry. Once open it is managed by the position manager exactly like
 * an autopilot trade; nothing downstream filters on `source`.
 */
export const openManualPaperTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ManualTradeInput.parse(d))
  .handler(async ({ data, context }) => {
    const { checkAccountProtection } = await import("@/lib/trades.server");
    const guard = await checkAccountProtection(context.supabase, context.userId, "paper");
    if (!guard.ok) return { ok: false as const, reason: guard.reason ?? "Blocked" };

    const wrongSide =
      data.direction === "BUY" ? data.stop_loss >= data.entry_price : data.stop_loss <= data.entry_price;
    if (wrongSide) return { ok: false as const, reason: "Stop loss is on the wrong side of entry." };

    const rr = data.take_profit_1
      ? Math.abs(data.take_profit_1 - data.entry_price) / Math.max(0.01, Math.abs(data.entry_price - data.stop_loss))
      : null;

    const { data: row, error } = await context.supabase.from("trades").insert({
      user_id: context.userId,
      symbol: "XAUUSD",
      direction: data.direction,
      entry_price: data.entry_price,
      stop_loss: data.stop_loss,
      initial_stop_loss: data.stop_loss,
      take_profit_1: data.take_profit_1 ?? null,
      take_profit_2: data.take_profit_2 ?? null,
      take_profit_3: data.take_profit_3 ?? null,
      lot_size: data.lot_size,
      risk_reward: rr,
      timeframe: data.timeframe ?? null,
      session: data.session ?? null,
      reason_entry: data.note ? `Manual entry — ${data.note}` : "Manual entry",
      source: "manual",
      environment: data.environment ?? null,
      mode: "paper",
      status: "open",
    }).select().single();
    if (error) throw new Error(error.message);
    return { ok: true as const, trade: row };
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

const BreakevenInput = z.object({ id: z.string().uuid() });

/**
 * Move an open trade's stop loss to its entry price. Live trades go through
 * the broker modify path (which verifies the broker actually accepted the new
 * stop); paper trades update the row directly.
 */
export const moveStopToBreakeven = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => BreakevenInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: trade, error } = await context.supabase
      .from("trades").select("*").eq("id", data.id).eq("user_id", context.userId).single();
    if (error || !trade) throw new Error("Trade not found");
    if (trade.status !== "open") throw new Error("Trade is not open");

    const entry = Number(trade.entry_price);
    if (Math.abs(Number(trade.stop_loss) - entry) < 1e-9) {
      return { ok: true as const, already: true };
    }

    if (trade.mode === "live") {
      const { modifyLiveOrderCore } = await import("@/lib/brokers/live-execution.server");
      const res = await modifyLiveOrderCore(context.supabase, context.userId, {
        id: trade.id, stop_loss: entry,
      });
      if ((res as any)?.ok === false) throw new Error((res as any)?.reason ?? "Broker did not confirm the new stop");
    } else {
      const { error: uErr } = await context.supabase.from("trades").update({
        stop_loss: entry,
      }).eq("id", trade.id).eq("user_id", context.userId);
      if (uErr) throw new Error(uErr.message);
    }
    return { ok: true as const, already: false };
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
    const [{ data: acct }, { data: trades }, { data: settings }, { data: conn }] = await Promise.all([
      context.supabase.from("paper_account").select("*").eq("user_id", context.userId).maybeSingle(),
      context.supabase.from("trades").select("pnl, status, opened_at, closed_at").eq("user_id", context.userId),
      context.supabase.from("user_settings").select("trading_mode").eq("user_id", context.userId).maybeSingle(),
      context.supabase.from("broker_connections").select("broker_id, label, balance, equity, free_margin, currency, account_type").eq("user_id", context.userId).eq("is_default", true).maybeSingle(),
    ]);

    // One authoritative balance. In live/broker mode the autopilot sizes and
    // trades from the BROKER account, so the dashboard must show that same
    // account — never the internal paper account. The paper account is
    // mirror-synced to the broker balance so the two can never drift apart
    // and switching back to paper mode starts from the same number.
    interface SnapshotAccount {
      balance: number;
      equity: number;
      free_margin: number;
      margin_used: number;
      currency: string;
      source: string;
      broker_label?: string | null;
      account_type?: string;
    }
    let account: SnapshotAccount = {
      balance: Number(acct?.balance ?? 10000),
      equity: Number(acct?.equity ?? 10000),
      free_margin: Number(acct?.free_margin ?? 10000),
      margin_used: Number(acct?.margin_used ?? 0),
      currency: "USD",
      source: "paper_account",
    };
    if (settings?.trading_mode === "live" && conn?.balance != null) {
      const balance = Number(conn.balance);
      const equity = conn.equity != null ? Number(conn.equity) : balance;
      const freeMargin = conn.free_margin != null ? Number(conn.free_margin) : equity;
      account = {
        balance,
        equity,
        free_margin: freeMargin,
        margin_used: Math.max(0, equity - freeMargin),
        currency: conn.currency ?? "USD",
        source: `broker:${conn.broker_id}`,
        broker_label: conn.label ?? conn.broker_id,
        account_type: conn.account_type,
      };
      const drift =
        !acct ||
        Math.abs(Number(acct.balance) - balance) > 0.01 ||
        Math.abs(Number(acct.equity) - equity) > 0.01;
      if (drift) {
        await context.supabase.from("paper_account").upsert({
          user_id: context.userId,
          balance,
          equity,
          free_margin: freeMargin,
          margin_used: Math.max(0, equity - freeMargin),
          updated_at: new Date().toISOString(),
        });
      }
    }
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
      account,
      open_count: open.length,
      closed_count: closed.length,
      daily_pnl: sumSince(dayStart),
      weekly_pnl: sumSince(weekStart),
      monthly_pnl: sumSince(monthStart),
      win_rate: closed.length ? (wins / closed.length) * 100 : 0,
    };
  });
