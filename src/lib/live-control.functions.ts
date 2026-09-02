// Explicit, user-triggered live controls.
//
// Two deliberately manual actions that sit beside the always-on autopilot:
//   * runManualCycle  — run the full decision pipeline once and RETURN the
//                       proposal without submitting anything.
//   * approveManualCycle — re-run the same pipeline for real, so every safety
//                       gate is re-evaluated against fresh prices at the moment
//                       of execution rather than against a stale proposal.
//   * flattenAllPositions — close every open position (broker first in live
//                       mode, then the row) and report per-trade outcomes.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const runManualCycle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { runCycleForUser } = await import("@/lib/services/tick.server");
    const res = await runCycleForUser(context.userId, { dryRun: true });
    return {
      ok: true as const,
      managed: res.managed,
      errors: res.errors ?? [],
      proposal: res.proposal,
    };
  });

export const approveManualCycle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ confirm: z.literal(true) }).parse(d))
  .handler(async ({ context }) => {
    const { runCycleForUser } = await import("@/lib/services/tick.server");
    // Not a replay of the reviewed plan: the pipeline runs again end-to-end, so
    // a setup that has since been invalidated simply does not execute.
    const res = await runCycleForUser(context.userId, { dryRun: false });
    return {
      ok: true as const,
      opened: res.opened,
      managed: res.managed,
      errors: res.errors ?? [],
      proposal: res.proposal,
    };
  });

export const flattenAllPositions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ confirm: z.literal(true) }).parse(d))
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: open } = await supabase
      .from("trades").select("*").eq("user_id", userId).eq("status", "open");
    const trades = open ?? [];
    if (trades.length === 0) return { ok: true as const, closed: 0, failed: 0, results: [] };

    const { fetchSpotQuote } = await import("@/lib/services/spot.server");
    const quote = await fetchSpotQuote().catch(() => null);

    const { closeLiveOrderCore } = await import("@/lib/brokers/live-execution.server");

    let closed = 0;
    let failed = 0;
    const results: { id: string; ok: boolean; detail: string }[] = [];

    for (const t of trades) {
      const isBuy = t.direction === "BUY";
      // Exit at the side of the book we'd actually cross.
      const exit =
        (isBuy ? quote?.bid : quote?.ask) ?? quote?.mid ?? Number(t.entry_price);
      try {
        if (t.mode === "live") {
          const res = await closeLiveOrderCore(supabase, userId, {
            id: t.id, exit_price: exit, reason_exit: "Manual flatten-all",
          });
          if ((res as any)?.ok === false) throw new Error((res as any)?.reason ?? "broker close unconfirmed");
        } else {
          const diff = isBuy ? exit - Number(t.entry_price) : Number(t.entry_price) - exit;
          const pnl = diff * 100 * Number(t.lot_size);
          const { error } = await supabase.from("trades").update({
            status: "closed",
            exit_price: exit,
            pnl,
            reason_exit: "Manual flatten-all",
            closed_at: new Date().toISOString(),
          }).eq("id", t.id).eq("user_id", userId);
          if (error) throw new Error(error.message);

          const { data: acct } = await supabase
            .from("paper_account").select("*").eq("user_id", userId).maybeSingle();
          if (acct) {
            const bal = Number(acct.balance) + pnl;
            await supabase.from("paper_account").update({
              balance: bal, equity: bal, free_margin: bal, updated_at: new Date().toISOString(),
            }).eq("user_id", userId);
          }
        }
        closed += 1;
        results.push({ id: t.id, ok: true, detail: `closed at ${exit}` });
      } catch (e: any) {
        failed += 1;
        // A failed live close leaves the row flagged for reconciliation by the
        // close core; it is never silently marked closed here.
        results.push({ id: t.id, ok: false, detail: String(e?.message ?? e).slice(0, 200) });
      }
    }

    return { ok: true as const, closed, failed, results };
  });
