import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getUserSettings, updateUserSettings } from "@/lib/settings.functions";
import { toast } from "sonner";
import { ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
  head: () => ({
    meta: [
      { title: "Settings · GoldMind AI" },
      { name: "description", content: "Configure risk limits, timeframes, sessions, and trading mode." },
    ],
  }),
});

function SettingsPage() {
  const getFn = useServerFn(getUserSettings);
  const setFn = useServerFn(updateUserSettings);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["settings"], queryFn: () => getFn() });
  const [form, setForm] = useState<any>(null);

  useEffect(() => { if (q.data) setForm(q.data); }, [q.data]);

  const save = useMutation({
    mutationFn: () => setFn({ data: {
      risk_per_trade: Number(form.risk_per_trade),
      max_daily_loss: Number(form.max_daily_loss),
      max_weekly_loss: Number(form.max_weekly_loss),
      max_trades_per_day: Number(form.max_trades_per_day),
      max_open_trades: Number(form.max_open_trades),
      preferred_timeframe: String(form.preferred_timeframe),
      preferred_session: String(form.preferred_session),
      avoid_news: !!form.avoid_news,
      notify_browser: !!form.notify_browser,
      notify_email: !!form.notify_email,
      live_trading_enabled: !!form.live_trading_enabled,
      auto_execute: !!form.auto_execute,
    } }),
    onSuccess: () => { toast.success("Settings saved"); qc.invalidateQueries({ queryKey: ["settings"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  if (!form) return <div className="p-6 text-sm text-muted-foreground">Loading settings…</div>;

  const upd = (k: string, v: any) => setForm({ ...form, [k]: v });

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-6">
      <header>
        <h1 className="font-display text-2xl md:text-3xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Fine-tune risk, sessions, and trading mode.</p>
      </header>

      <Section title="Risk management">
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Risk per trade (%)" v={form.risk_per_trade} onChange={(v: any) => upd("risk_per_trade", v)} type="number" step="0.1" />
          <Field label="Max daily loss (%)" v={form.max_daily_loss} onChange={(v: any) => upd("max_daily_loss", v)} type="number" step="0.1" />
          <Field label="Max weekly loss (%)" v={form.max_weekly_loss} onChange={(v: any) => upd("max_weekly_loss", v)} type="number" step="0.1" />
          <Field label="Max trades / day" v={form.max_trades_per_day} onChange={(v: any) => upd("max_trades_per_day", v)} type="number" />
          <Field label="Max open trades" v={form.max_open_trades} onChange={(v: any) => upd("max_open_trades", v)} type="number" />
        </div>
      </Section>

      <Section title="Trading preferences">
        <div className="grid md:grid-cols-2 gap-4">
          <SelectField label="Preferred timeframe" v={form.preferred_timeframe} onChange={(v: any) => upd("preferred_timeframe", v)}
            options={[["1","1m"],["5","5m"],["15","15m"],["30","30m"],["60","1H"],["240","4H"],["D","1D"]]} />
          <SelectField label="Preferred session" v={form.preferred_session} onChange={(v: any) => upd("preferred_session", v)}
            options={[["Asian","Asian"],["London","London"],["New York","New York"]]} />
        </div>
        <Toggle label="Avoid trading around high-impact news" v={form.avoid_news} onChange={(v: any) => upd("avoid_news", v)} />
      </Section>

      <Section title="Notifications">
        <Toggle label="Browser notifications" v={form.notify_browser} onChange={(v: any) => upd("notify_browser", v)} />
        <Toggle label="Email notifications" v={form.notify_email} onChange={(v: any) => upd("notify_email", v)} />
      </Section>

      <Section title="Live trading">
        <div className="rounded-lg border border-[color:var(--warning)]/40 bg-[color:var(--warning)]/5 p-3 text-xs text-[color:var(--warning)] flex gap-2">
          <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
          <span>Live MT5 execution isn't connected yet in this build. Enabling this only reveals the placeholder connection screen — no real orders are sent.</span>
        </div>
        <Toggle label="Enable live trading UI (paper only for now)" v={form.live_trading_enabled} onChange={(v: any) => upd("live_trading_enabled", v)} />
        <Toggle label="Auto-execute AI setups" v={form.auto_execute} onChange={(v: any) => upd("auto_execute", v)} />
      </Section>

      <div className="flex justify-end">
        <button onClick={() => save.mutate()} disabled={save.isPending}
          className="px-6 py-2.5 rounded-lg font-medium text-[color:var(--gold-foreground)] disabled:opacity-60"
          style={{ background: "var(--gradient-gold)", boxShadow: "var(--shadow-gold)" }}>
          {save.isPending ? "Saving…" : "Save settings"}
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: any) {
  return (
    <div className="glass-panel rounded-2xl p-5 space-y-4">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      {children}
    </div>
  );
}
function Field({ label, v, onChange, type = "text", step }: any) {
  return (
    <label className="block">
      <span className="block text-xs text-muted-foreground mb-1.5">{label}</span>
      <input type={type} step={step} value={v} onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg bg-input border border-border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[color:var(--gold)]/40" />
    </label>
  );
}
function SelectField({ label, v, onChange, options }: any) {
  return (
    <label className="block">
      <span className="block text-xs text-muted-foreground mb-1.5">{label}</span>
      <select value={v} onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg bg-input border border-border text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--gold)]/40">
        {options.map(([val, lbl]: any) => <option key={val} value={val}>{lbl}</option>)}
      </select>
    </label>
  );
}
function Toggle({ label, v, onChange }: any) {
  return (
    <label className="flex items-center justify-between py-2 cursor-pointer">
      <span className="text-sm">{label}</span>
      <button type="button" onClick={() => onChange(!v)}
        className={`relative h-6 w-11 rounded-full transition-colors ${v ? "bg-[color:var(--gold)]" : "bg-secondary"}`}>
        <span className={`absolute top-0.5 h-5 w-5 bg-background rounded-full transition-transform ${v ? "translate-x-5" : "translate-x-0.5"}`} />
      </button>
    </label>
  );
}
