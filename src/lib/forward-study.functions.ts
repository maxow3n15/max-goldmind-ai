import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { studyStats } from "./forward-study";

const PageInput = z.object({ studyId: z.string().uuid().nullable().default(null), page: z.number().int().min(0).default(0), outcome: z.enum(["accepted", "rejected", "error"]).nullable().default(null), tab: z.enum(["decisions", "trades"]).default("decisions") });

export const getForwardStudy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => PageInput.parse(value ?? {}))
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const [{ data: studies, error }, { data: settings }, { data: broker }] = await Promise.all([
      db.from("forward_studies").select("*").eq("user_id", context.userId).order("started_at", { ascending: false }),
      db.from("user_settings").select("auto_execute, kill_switch_active, trading_mode, live_trading_enabled").eq("user_id", context.userId).maybeSingle(),
      db.from("broker_connections").select("id, broker_id, label, account_type, status, currency, last_sync_at").eq("user_id", context.userId).eq("is_default", true).maybeSingle(),
    ]);
    if (error) throw new Error("Could not load forward studies.");
    const study = data.studyId ? studies?.find((row) => row.id === data.studyId) ?? null : studies?.[0] ?? null;
    if (!study) return { studies: studies ?? [], study: null, settings, broker, stats: studyStats([]), decisionCount: 0, rows: [], rowCount: 0, curve: [] };
    // Fetch every closed result in bounded pages. Never present a 1000-row truncation as complete statistics.
    const allTrades: any[] = [];
    for (let offset = 0; ; offset += 500) {
      const result = await db.from("trades").select("*").eq("study_id", study.id).eq("user_id", context.userId).order("opened_at").order("id").range(offset, offset + 499);
      if (result.error) throw new Error("Could not load study results.");
      allTrades.push(...(result.data ?? []));
      if ((result.data?.length ?? 0) < 500) break;
    }
    const count = await db.from("decision_logs").select("id", { count: "exact", head: true }).eq("study_id", study.id).eq("user_id", context.userId);
    if (count.error) throw new Error("Could not count study decisions.");
    let rowsQuery = data.tab === "decisions"
      ? db.from("decision_logs").select("*", { count: "exact" }).eq("study_id", study.id).eq("user_id", context.userId).order("decided_at", { ascending: false }).order("id")
      : db.from("trades").select("*", { count: "exact" }).eq("study_id", study.id).eq("user_id", context.userId).order("opened_at", { ascending: false }).order("id");
    if (data.tab === "decisions" && data.outcome) rowsQuery = rowsQuery.eq("outcome", data.outcome);
    const pageResult = await rowsQuery.range(data.page * 50, data.page * 50 + 49);
    if (pageResult.error) throw new Error("Could not load study history.");
    let cumulative = 0;
    const { tradeReturnR } = await import("./trade-result");
    const curve = allTrades.filter((trade) => trade.status === "closed" && trade.closed_at).sort((a, b) => a.closed_at.localeCompare(b.closed_at)).flatMap((trade) => {
      const r = tradeReturnR(trade);
      if (r == null) return [];
      cumulative += r;
      return [{ date: trade.closed_at, r, cumulative: Number(cumulative.toFixed(3)) }];
    });
    return { studies: studies ?? [], study, settings, broker, stats: studyStats(allTrades), decisionCount: count.count ?? 0, rows: pageResult.data ?? [], rowCount: pageResult.count ?? 0, curve };
  });

const ControlInput = z.object({ action: z.enum(["start", "pause", "resume", "end"]), studyId: z.string().uuid().nullable().default(null), confirmed: z.boolean().default(false) });
export const controlForwardStudy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => ControlInput.parse(value))
  .handler(async ({ data, context }) => {
    if ((data.action === "start" || data.action === "resume") && !data.confirmed) throw new Error("Confirm OANDA demo automation before continuing.");
    let connectionId: string | null = null;
    if (data.action === "start" || data.action === "resume") {
      const { loadDefaultBrokerConnection, resolveConnectionEnvironment } = await import("./brokers/live-execution.server");
      const { getConnector } = await import("./brokers/connectors.server");
      const conn = await loadDefaultBrokerConnection(context.supabase, context.userId);
      if (!conn || conn.broker_id !== "oanda") throw new Error("Set your OANDA practice account as the default broker first.");
      const resolved = await resolveConnectionEnvironment(conn);
      if (resolved.env !== "oanda_practice" || resolved.isDemo !== true) throw new Error("This study only supports a verified OANDA practice account.");
      if (data.action === "resume") {
        const result = await context.supabase.from("forward_studies").select("broker_connection_id").eq("id", data.studyId ?? "").eq("user_id", context.userId).single();
        if (result.error || result.data.broker_connection_id !== conn.id) throw new Error("Restore the original study account before resuming.");
      }
      try { await getConnector("oanda").fetchAccount(resolved.credentials); }
      catch { throw new Error("OANDA practice authorization failed. Renew the practice token and matching account before starting the study."); }
      connectionId = conn.id;
    }
    // Atomic lifecycle/floor updates, owner-scoped and independently validated by the database.
    const { data: result, error } = await (context.supabase as any).rpc("control_forward_study", { p_action: data.action, p_study_id: data.studyId, p_connection_id: connectionId });
    if (error) throw new Error(error.message);
    return { ok: true, studyId: String(result) };
  });