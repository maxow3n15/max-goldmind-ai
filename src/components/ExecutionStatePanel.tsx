// Authoritative execution state, arming status and the practice pipeline test.
// Everything shown here is computed server-side; this component only renders.

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getExecutionState, runDemoExecutionTest } from "@/lib/execution-state.functions";
import { fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Activity, AlertTriangle, CheckCircle2, Lock, Loader2, PlayCircle, RefreshCw, ShieldCheck, XCircle,
} from "lucide-react";

const STATE_TONE: Record<string, string> = {
  ARMED: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10",
  MONITORING: "text-sky-400 border-sky-500/40 bg-sky-500/10",
  CONNECTED: "text-muted-foreground border-border bg-muted/20",
  DISCONNECTED: "text-amber-400 border-amber-500/40 bg-amber-500/10",
  ADMIN_LOCKED: "text-amber-400 border-amber-500/40 bg-amber-500/10",
  KILL_SWITCH: "text-red-400 border-red-500/40 bg-red-500/10",
  FAILED: "text-red-400 border-red-500/40 bg-red-500/10",
};

export function ExecutionStatePanel() {
  const fetchState = useServerFn(getExecutionState);
  const runTest = useServerFn(runDemoExecutionTest);
  const [placeOrder, setPlaceOrder] = useState(false);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["execution-state"],
    queryFn: () => fetchState({}),
    refetchInterval: 15_000,
  });

  const test = useMutation({
    mutationFn: () => runTest({ data: { placeOrder } }),
    onSettled: () => refetch(),
  });

  if (!data) {
    return (
      <div className="glass-panel rounded-xl p-4 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Reading execution state…
      </div>
    );
  }

  const money = (v: number | null) => (v == null ? "—" : fmtUsd(v));
  const dailyPct = data.today.daily_loss_used_pct;

  return (
    <section className="glass-panel rounded-xl p-4 space-y-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Execution state</div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className={cn("px-2 py-0.5 rounded-md border font-mono text-xs", STATE_TONE[data.state] ?? STATE_TONE["CONNECTED"])}>
              {data.state}
            </span>
            <span className="px-2 py-0.5 rounded-md border border-border bg-muted/20 font-mono text-xs">
              {data.arming.replace(/_/g, " ")}
            </span>
            <span className="text-xs text-muted-foreground">{data.environment_label}</span>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          className="text-xs inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-border hover:bg-muted/30"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} /> Refresh
        </button>
      </header>

      {data.admin_lock.active && data.real_money && (
        <div className="flex items-start gap-2 text-xs rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-amber-300">
          <Lock className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Real-money execution is fully implemented but <strong>administratively locked</strong>. Practice/demo
            execution is unaffected.
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: `Equity (${data.account.currency})`, value: money(data.account.equity) },
          { label: "Balance", value: money(data.account.balance) },
          { label: "Free margin", value: money(data.account.free_margin) },
          { label: "Open positions", value: String(data.account.open_positions ?? data.open_trades) },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-border bg-muted/10 p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
            <div className="font-mono text-lg tabular-nums">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <div className="rounded-lg border border-border bg-muted/10 p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Account source</div>
          <div className="font-mono">{data.account.source}</div>
        </div>
        <div className="rounded-lg border border-border bg-muted/10 p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Broker heartbeat</div>
          <div className="font-mono flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5" />
            {data.broker_connection}
            {data.broker_last_check && (
              <span className="text-muted-foreground">
                · {new Date(data.broker_last_check).toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-muted/10 p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Daily loss used ({dailyPct.toFixed(2)}% of {data.today.daily_loss_limit_pct}%)
          </div>
          <div className="font-mono">{fmtUsd(data.today.pnl)} · {data.today.trades} trades</div>
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Arming requirements</div>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-1.5 text-xs">
          {data.requirements.map((r) => (
            <li key={r.key} className="flex items-start gap-2">
              {r.ok ? (
                <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-emerald-400 shrink-0" />
              ) : (
                <XCircle className="h-3.5 w-3.5 mt-0.5 text-red-400 shrink-0" />
              )}
              <span className={cn(!r.ok && "text-red-300")}>{r.ok ? r.label : (r.detail ?? r.label)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-lg border border-border p-3 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-xs font-medium flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-[color:var(--gold)]" /> Demo execution test
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5 max-w-md">
              Runs the full pipeline against a practice/demo account only: credentials, account, instrument spec,
              price, order, SL/TP verification, close and reconciliation.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-[11px] flex items-center gap-1.5">
              <input type="checkbox" checked={placeOrder} onChange={(e) => setPlaceOrder(e.target.checked)} />
              Place a real 0.01 demo order
            </label>
            <button
              disabled={test.isPending}
              onClick={() => test.mutate()}
              className="text-xs inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[color:var(--gold)]/40 text-[color:var(--gold)] hover:bg-[color:var(--gold)]/10 disabled:opacity-50"
            >
              {test.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
              Run test
            </button>
          </div>
        </div>

        {test.error && (
          <div className="text-xs text-red-300 flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5" /> {String((test.error as Error).message)}
          </div>
        )}

        {test.data && (
          <ul className="space-y-1 text-[11px] font-mono">
            {test.data.steps.map((s, i) => (
              <li key={`${s.step}-${i}`} className="flex items-start gap-2">
                {s.ok ? (
                  <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-emerald-400 shrink-0" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 mt-0.5 text-red-400 shrink-0" />
                )}
                <span className="text-muted-foreground w-40 shrink-0">{s.step}</span>
                <span className={cn(!s.ok && "text-red-300")}>{s.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
