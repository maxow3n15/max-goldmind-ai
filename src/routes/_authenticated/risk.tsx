import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ShieldCheck, Webhook, RefreshCw, Copy, Bot, Hand, Gauge } from "lucide-react";
import {
  getRiskSettings, updateRiskSettings, setExecutionMode,
  rotateWebhookToken, setWebhookEnabled, listWebhookSignals, EXECUTION_MODES,
} from "@/lib/risk.functions";

export const Route = createFileRoute("/_authenticated/risk")({
  component: RiskPage,
  head: () => ({
    meta: [
      { title: "Risk Engine · GoldMind AI" },
      { name: "description", content: "Configure GoldMind AI capital protection: per-trade risk, exposure caps, drawdown lockouts, cooldowns, recovery mode and TradingView signal intake." },
      { property: "og:title", content: "Risk Engine · GoldMind AI" },
      { property: "og:description", content: "Institutional risk controls and external signal intake for the GoldMind AI gold trading engine." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

const MODE_COPY: Record<string, { icon: any; title: string; body: string }> = {
  manual: { icon: Hand, title: "Manual", body: "The AI analyses and alerts. You place every trade yourself." },
  assisted: { icon: Gauge, title: "AI-assisted", body: "The AI prepares a complete order ticket; you approve before it is sent." },
  autonomous: { icon: Bot, title: "Autonomous", body: "The AI executes and manages trades on its own, inside every risk limit." },
};

function Field({ label, hint, children }: { label: string; hint?: string; children: any }) {
  return (
    <label className="text-xs space-y-1.5 block">
      <span className="text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-muted-foreground/80">{hint}</span>}
    </label>
  );
}

function RiskPage() {
  const qc = useQueryClient();
  const getFn = useServerFn(getRiskSettings);
  const saveFn = useServerFn(updateRiskSettings);
  const modeFn = useServerFn(setExecutionMode);
  const rotateFn = useServerFn(rotateWebhookToken);
  const toggleFn = useServerFn(setWebhookEnabled);
  const signalsFn = useServerFn(listWebhookSignals);

  const settings = useQuery({ queryKey: ["risk-settings"], queryFn: () => getFn() });
  const signals = useQuery({ queryKey: ["webhook-signals"], queryFn: () => signalsFn() });

  const [form, setForm] = useState({
    max_risk_per_trade_pct: 0.5,
    max_total_exposure_lots: 1,
    max_correlated_trades: 2,
    max_drawdown_pct: 10,
    cooldown_minutes: 15,
    recovery_mode_enabled: true,
  });

  useEffect(() => {
    const s: any = settings.data;
    if (!s) return;
    setForm({
      max_risk_per_trade_pct: Number(s.max_risk_per_trade_pct ?? 0.5),
      max_total_exposure_lots: Number(s.max_total_exposure_lots ?? 1),
      max_correlated_trades: Number(s.max_correlated_trades ?? 2),
      max_drawdown_pct: Number(s.max_drawdown_pct ?? 10),
      cooldown_minutes: Number(s.cooldown_minutes ?? 15),
      recovery_mode_enabled: s.recovery_mode_enabled !== false,
    });
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => saveFn({ data: form }),
    onSuccess: () => { toast.success("Risk limits updated"); qc.invalidateQueries({ queryKey: ["risk-settings"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Could not save risk limits"),
  });

  const changeMode = useMutation({
    mutationFn: (m: string) => modeFn({ data: { execution_mode: m as any } }),
    onSuccess: () => { toast.success("Execution mode updated"); qc.invalidateQueries({ queryKey: ["risk-settings"] }); },
  });

  const rotate = useMutation({
    mutationFn: () => rotateFn(),
    onSuccess: () => { toast.success("New webhook token generated"); qc.invalidateQueries({ queryKey: ["risk-settings"] }); },
  });

  const toggleWebhook = useMutation({
    mutationFn: (enabled: boolean) => toggleFn({ data: { enabled } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["risk-settings"] }),
  });

  const s: any = settings.data ?? {};
  const mode = (s.execution_mode ?? "assisted") as string;
  const token: string | null = s.webhook_token ?? null;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const webhookUrl = token ? `${origin}/api/public/webhook/${token}` : null;
  const rows: any[] = Array.isArray(signals.data) ? signals.data : [];

  return (
    <div className="p-5 md:p-8 space-y-6 max-w-5xl">
      <header>
        <h1 className="font-display text-2xl font-semibold flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-[color:var(--gold)]" /> Risk Engine
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          One authority decides whether a trade may be taken and how large it may be. These limits apply to live
          execution, paper trading and every backtest.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Execution mode</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {EXECUTION_MODES.map((m) => {
            const copy = MODE_COPY[m];
            const Icon = copy.icon;
            return (
              <button key={m} onClick={() => changeMode.mutate(m)}
                className={`text-left glass-panel rounded-xl p-4 border transition-colors ${
                  mode === m ? "border-[color:var(--gold)]" : "border-border hover:bg-accent"
                }`}>
                <div className="flex items-center gap-2 font-medium text-sm">
                  <Icon className="h-4 w-4 text-[color:var(--gold)]" /> {copy.title}
                </div>
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{copy.body}</p>
              </button>
            );
          })}
        </div>
      </section>

      <section className="glass-panel rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-medium">Capital protection</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Max risk per trade (%)" hint="Hard ceiling on any single position.">
            <input type="number" step={0.1} min={0.1} max={2} value={form.max_risk_per_trade_pct}
              onChange={(e) => setForm({ ...form, max_risk_per_trade_pct: Number(e.target.value) })}
              className="w-full bg-background border border-border rounded-md px-2 py-2 text-sm" />
          </Field>
          <Field label="Max total exposure (lots)" hint="Combined size across all open positions.">
            <input type="number" step={0.01} min={0.01} value={form.max_total_exposure_lots}
              onChange={(e) => setForm({ ...form, max_total_exposure_lots: Number(e.target.value) })}
              className="w-full bg-background border border-border rounded-md px-2 py-2 text-sm" />
          </Field>
          <Field label="Max same-direction trades" hint="Limits correlated exposure to one move.">
            <input type="number" step={1} min={1} max={10} value={form.max_correlated_trades}
              onChange={(e) => setForm({ ...form, max_correlated_trades: Number(e.target.value) })}
              className="w-full bg-background border border-border rounded-md px-2 py-2 text-sm" />
          </Field>
          <Field label="Max drawdown (%)" hint="Trading locks out when equity falls this far from its peak.">
            <input type="number" step={0.5} min={1} max={50} value={form.max_drawdown_pct}
              onChange={(e) => setForm({ ...form, max_drawdown_pct: Number(e.target.value) })}
              className="w-full bg-background border border-border rounded-md px-2 py-2 text-sm" />
          </Field>
          <Field label="Cooldown after a loss (min)" hint="Prevents immediate re-entry after a losing trade.">
            <input type="number" step={1} min={0} max={720} value={form.cooldown_minutes}
              onChange={(e) => setForm({ ...form, cooldown_minutes: Number(e.target.value) })}
              className="w-full bg-background border border-border rounded-md px-2 py-2 text-sm" />
          </Field>
          <label className="flex items-start gap-2 text-xs pt-5">
            <input type="checkbox" checked={form.recovery_mode_enabled}
              onChange={(e) => setForm({ ...form, recovery_mode_enabled: e.target.checked })} className="mt-0.5" />
            <span>
              Recovery mode
              <span className="block text-[10px] text-muted-foreground">Halve position size after consecutive losses or heavy drawdown.</span>
            </span>
          </label>
        </div>
        <button onClick={() => save.mutate()} disabled={save.isPending}
          className="rounded-md bg-[color:var(--gold)] text-black px-4 py-2 text-sm font-medium disabled:opacity-60">
          {save.isPending ? "Saving…" : "Save risk limits"}
        </button>
      </section>

      <section className="glass-panel rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium flex items-center gap-2">
            <Webhook className="h-4 w-4 text-[color:var(--gold)]" /> TradingView signal intake
          </h2>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={!!s.webhook_enabled}
              onChange={(e) => toggleWebhook.mutate(e.target.checked)} />
            Enabled
          </label>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Point a TradingView alert at this URL. Incoming signals are queued for AI review — they are never executed
          without passing the confidence threshold and the risk engine.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="flex-1 min-w-[240px] text-[11px] bg-background border border-border rounded-md px-3 py-2 break-all">
            {webhookUrl ?? "No webhook token generated yet"}
          </code>
          {webhookUrl && (
            <button onClick={() => { navigator.clipboard.writeText(webhookUrl); toast.success("Webhook URL copied"); }}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs hover:bg-accent">
              <Copy className="h-3.5 w-3.5" /> Copy
            </button>
          )}
          <button onClick={() => rotate.mutate()} disabled={rotate.isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs hover:bg-accent disabled:opacity-60">
            <RefreshCw className="h-3.5 w-3.5" /> {token ? "Rotate token" : "Generate token"}
          </button>
        </div>
        <pre className="text-[11px] bg-background border border-border rounded-md p-3 overflow-x-auto">
{`{"action":"buy","symbol":"XAUUSD","price":{{close}},"comment":"{{strategy.order.comment}}"}`}
        </pre>

        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">Recent signals</h3>
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 text-xs border-t border-border/50 pt-2">
              <span className="text-muted-foreground whitespace-nowrap">{new Date(r.received_at).toLocaleString()}</span>
              <span className={r.action === "buy" ? "text-emerald-400" : r.action === "sell" ? "text-red-400" : ""}>
                {String(r.action).toUpperCase()}
              </span>
              <span>{r.symbol}</span>
              <span className="tabular-nums text-muted-foreground">{r.price ?? "—"}</span>
              <span className="ml-auto text-muted-foreground">{r.status}</span>
            </div>
          ))}
          {!rows.length && <div className="text-xs text-muted-foreground">No signals received yet.</div>}
        </div>
      </section>
    </div>
  );
}
