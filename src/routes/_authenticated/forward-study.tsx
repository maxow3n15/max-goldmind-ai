import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Play, Pause, Square, ChevronLeft, ChevronRight, RefreshCw, FlaskConical, ShieldCheck } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine } from "recharts";
import { getForwardStudy, controlForwardStudy } from "@/lib/forward-study.functions";
import { tradeReturnR } from "@/lib/trade-result";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/forward-study")({
  component: ForwardStudyPage,
  head: () => ({ meta: [
    { title: "Forward study · GoldMind AI" },
    { name: "description", content: "OANDA practice forward research at the fixed 88% confidence floor, with every recorded decision and trade result." },
    { property: "og:title", content: "Forward study · GoldMind AI" },
    { property: "og:description", content: "Track demo-only XAUUSD research, decisions and results at the 88% confidence gate." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
  ] }),
});

function ForwardStudyPage() {
  const getFn = useServerFn(getForwardStudy);
  const controlFn = useServerFn(controlForwardStudy);
  const qc = useQueryClient();
  const [studyId, setStudyId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [tab, setTab] = useState<"decisions" | "trades">("decisions");
  const [outcome, setOutcome] = useState<"accepted" | "rejected" | "error" | null>(null);
  const [confirm, setConfirm] = useState<"start" | "resume" | "end" | null>(null);
  const query = useQuery({ queryKey: ["forward-study", studyId, page, tab, outcome], queryFn: () => getFn({ data: { studyId, page, tab, outcome } }), refetchInterval: 60_000 });
  const data = query.data;
  const study = data?.study;
  const openStudy = data?.studies.find((row) => row.status !== "ended");
  const control = useMutation({
    mutationFn: (action: "start" | "pause" | "resume" | "end") => controlFn({ data: { action, studyId: study?.id ?? null, confirmed: true } }),
    onSuccess: (_result, action) => { setConfirm(null); setPage(0); toast.success(`Study ${action === "start" ? "started" : action === "end" ? "ended" : action === "pause" ? "paused" : "resumed"}`); qc.invalidateQueries({ queryKey: ["forward-study"] }); qc.invalidateQueries({ queryKey: ["user-settings"] }); },
    onError: (error) => toast.error(error.message),
  });
  const brokerReady = data?.broker?.broker_id === "oanda" && data.broker.account_type === "demo" && data.broker.status === "connected";
  const currency = data?.broker?.currency ?? "account currency";
  const stats = data?.stats;
  return <div className="mx-auto max-w-[1400px] space-y-6 p-4 md:p-6">
    <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:justify-between">
      <div className="min-w-0"><h1 className="font-display text-2xl font-semibold">Forward study</h1><p className="mt-1 text-sm text-muted-foreground">XAUUSD · OANDA practice · 88% confidence gate</p></div>
      <Button variant="outline" size="icon" aria-label="Refresh study" disabled={query.isFetching} onClick={() => query.refetch()}><RefreshCw /></Button>
    </header>
    {query.isPending && <p className="text-muted-foreground">Loading study…</p>}
    {query.isError && <p role="alert" className="text-destructive">{query.error.message}</p>}
    {data && <>
      <section className="space-y-3 border-y border-border py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0"><h2 className="flex items-center gap-2 font-semibold"><FlaskConical className="h-4 w-4 shrink-0 text-gold" /> {study ? `${study.status[0]?.toUpperCase()}${study.status.slice(1)} study` : "No study started"}</h2><p className="mt-1 text-xs text-muted-foreground">{study ? `Started ${new Date(study.started_at).toLocaleString()} · ${study.broker_connection_id === data.broker?.id ? data.broker.label ?? "OANDA practice" : "Original pinned account"}` : data.broker?.label ?? "No default OANDA account"}</p></div>
          <div className="flex flex-wrap gap-2">
            {!openStudy && <Button disabled={control.isPending || !brokerReady} onClick={() => setConfirm("start")}><Play /> Start study</Button>}
            {study?.status === "active" && <Button variant="outline" disabled={control.isPending} onClick={() => control.mutate("pause")}><Pause /> Pause</Button>}
            {study?.status === "paused" && <Button disabled={control.isPending} onClick={() => setConfirm("resume")}><Play /> Resume</Button>}
            {study && study.status !== "ended" && <Button variant="outline" disabled={control.isPending} onClick={() => setConfirm("end")}><Square /> End study</Button>}
          </div>
        </div>
        {!brokerReady && <p className="text-sm text-warning">OANDA practice is not ready. Reconnect your practice token and matching account, then set it as the default.</p>}
        {data.settings?.kill_switch_active && <p className="text-sm text-destructive">Kill switch is active. The study cannot open trades.</p>}
        {data.settings?.trading_mode !== "live" && <p className="text-sm text-warning">Select broker-demo mode in Trading Mode before starting.</p>}
        <p className="text-xs text-muted-foreground">Scheduled operation is unverified until republishing the scheduler authorization change. No study result establishes live readiness.</p>
        <p className="flex items-center gap-2 text-xs text-gold"><ShieldCheck className="h-4 w-4 shrink-0" /> Real-money gate remains 88%; existing risk limits and kill switch remain in force.</p>
      </section>
      {data.studies.length > 0 && <Select value={study?.id ?? ""} onValueChange={(id) => { setStudyId(id); setPage(0); }}><SelectTrigger className="max-w-md" aria-label="Study history"><SelectValue placeholder="Study history" /></SelectTrigger><SelectContent>{data.studies.map((row) => <SelectItem key={row.id} value={row.id}>{new Date(row.started_at).toLocaleDateString()} · {row.status} · 88%</SelectItem>)}</SelectContent></Select>}
      <section className="grid grid-cols-2 gap-x-5 gap-y-4 lg:grid-cols-6">
        {[
          ["Days elapsed", study ? (Math.max(0, (new Date(study.ended_at ?? Date.now()).getTime() - new Date(study.started_at).getTime()) / 86400000)).toFixed(1) : "—"],
          ["Decisions", data.decisionCount], ["Closed trades", stats?.closed ?? 0],
          ["Win rate", stats?.winRate == null ? "—" : `${stats.winRate.toFixed(1)}%`],
          ["Expectancy", stats?.expectancyR == null ? "—" : `${stats.expectancyR.toFixed(2)}R`],
          ["Net P&L", `${stats?.netPnl.toFixed(2) ?? "0.00"} ${currency}`],
        ].map(([label, value]) => <div key={String(label)} className="min-w-0 border-b border-border pb-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 break-words font-mono text-lg">{value}</p></div>)}
      </section>
      <p className="text-xs text-muted-foreground">{stats?.sufficientSample ? "Minimum descriptive sample reached; profitability and live readiness remain unproven." : "Not enough data yet: at least 30 closed trades with measurable original risk are required."} {stats?.rSample ?? 0} measurable R results / {stats?.closed ?? 0} closed trades. Price-based R excludes costs not reflected in execution prices.</p>
      <section><h2 className="mb-3 font-semibold">Cumulative result</h2>{data.curve.length ? <div className="h-64"><ResponsiveContainer width="100%" height="100%"><LineChart data={data.curve}><XAxis dataKey="date" tickFormatter={(value) => new Date(value).toLocaleDateString()} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} /><YAxis tickFormatter={(value) => `${value}R`} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} /><ReferenceLine y={0} stroke="var(--border)" /><Tooltip labelFormatter={(value) => new Date(value).toLocaleString()} contentStyle={{ background: "var(--background)", borderColor: "var(--border)" }} /><Line dataKey="cumulative" name="Cumulative R" stroke="var(--gold)" dot={false} /></LineChart></ResponsiveContainer></div> : <p className="py-6 text-sm text-muted-foreground">No measurable closed results yet.</p>}</section>
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><Tabs value={tab} onValueChange={(value) => { setTab(value === "trades" ? "trades" : "decisions"); setPage(0); }}><TabsList><TabsTrigger value="decisions">Decisions</TabsTrigger><TabsTrigger value="trades">Trades & results</TabsTrigger></TabsList></Tabs>
          {tab === "decisions" && <Select value={outcome ?? "all"} onValueChange={(value) => { setOutcome(value === "accepted" || value === "rejected" || value === "error" ? value : null); setPage(0); }}><SelectTrigger className="w-36" aria-label="Filter decisions"><SelectValue /></SelectTrigger><SelectContent>{["all", "accepted", "rejected", "error"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>}
        </div>
        <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b border-border text-muted-foreground">{(tab === "decisions" ? ["Time", "Outcome", "Confidence / gate", "Setup", "Reasons & execution"] : ["Opened / closed", "Status", "Direction", "Result", "Details"]).map((label) => <th key={label} className="px-2 py-3 font-medium">{label}</th>)}</tr></thead><tbody>
          {(data.rows as any[]).map((row) => {
            const payload = row.payload ?? {};
            const r = tab === "trades" ? tradeReturnR(row) : null;
            return <tr key={row.id} className="border-b border-border/50 align-top"><td className="whitespace-nowrap px-2 py-3">{new Date(row.decided_at ?? row.opened_at).toLocaleString()}{row.closed_at && <div className="text-muted-foreground">{new Date(row.closed_at).toLocaleString()}</div>}</td><td className="px-2 py-3">{row.outcome ?? row.status}</td><td className="px-2 py-3">{tab === "decisions" ? `${row.confidence ?? "—"}% / ${payload.confidence_floor ?? "unrecorded"}` : row.direction}</td><td className="px-2 py-3">{tab === "decisions" ? payload.setup_model ?? "—" : <>{r == null ? "R unavailable" : `${r.toFixed(2)}R`}<div>{row.pnl == null ? "—" : `${Number(row.pnl).toFixed(2)} ${row.ai_analysis?.account_currency ?? currency}`}</div></>}</td><td className="min-w-64 max-w-lg px-2 py-3">{tab === "decisions" ? <><div>{[...(row.blockers ?? []), ...(row.reasoning ?? [])].join(" · ") || "—"}</div><div className="mt-1 text-muted-foreground">Submitted {payload.orders_submitted ?? 0} · Filled {payload.orders_filled ?? 0}</div>{payload.submission_errors?.length > 0 && <p className="text-destructive">{payload.submission_errors.join(" · ")}</p>}</> : <>{row.reason_entry ?? "—"}<div className="mt-1 text-muted-foreground">{row.reason_exit ?? ""}</div></>}</td></tr>;
          })}
        </tbody></table></div>
        {data.rows.length === 0 && <p className="py-6 text-sm text-muted-foreground">No {tab} recorded for this selection.</p>}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3"><p className="text-xs text-muted-foreground">{data.rowCount} records · Page {page + 1} of {Math.max(1, Math.ceil(data.rowCount / 50))}</p><div className="flex gap-2"><Button variant="outline" size="icon" aria-label="Previous page" disabled={page === 0} onClick={() => setPage((p) => p - 1)}><ChevronLeft /></Button><Button variant="outline" size="icon" aria-label="Next page" disabled={(page + 1) * 50 >= data.rowCount} onClick={() => setPage((p) => p + 1)}><ChevronRight /></Button></div></div>
      </section>
    </>}
    <AlertDialog open={confirm != null} onOpenChange={(open) => { if (!open && !control.isPending) setConfirm(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirm === "end" ? "End this study?" : "Authorize OANDA demo automation?"}</AlertDialogTitle><AlertDialogDescription>{confirm === "end" ? "New automated entries will stop. Existing positions are not closed; continue monitoring and managing them in Autopilot. The decision history remains available." : "This starts scheduled demo orders on your pinned OANDA practice account at the 88% gate. No real-money orders are authorized. Existing risk limits remain unchanged; the kill switch is never reset. Automatic browser entries are blocked while the study is open."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={control.isPending}>Cancel</AlertDialogCancel><Button disabled={control.isPending} onClick={() => { if (confirm) control.mutate(confirm); }}>{control.isPending ? "Checking…" : confirm === "end" ? "End study" : "Confirm demo study"}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}