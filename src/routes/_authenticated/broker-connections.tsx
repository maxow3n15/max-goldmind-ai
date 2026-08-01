import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Link2, Plus, RefreshCw, Star, Trash2, ShieldCheck, AlertTriangle, Loader2, X,
} from "lucide-react";
import {
  BROKERS, brokerSpec, maskAccountNumber, type BrokerSpec,
} from "@/lib/brokers/catalog";
import {
  connectBroker, disconnectBroker, listBrokerConnections,
  setDefaultBrokerConnection, syncBrokerConnection,
} from "@/lib/brokers.functions";

export const Route = createFileRoute("/_authenticated/broker-connections")({
  component: BrokerConnectionsPage,
  head: () => ({
    meta: [
      { title: "Broker Connections · GoldMind AI" },
      { name: "description", content: "Connect and manage the brokerage accounts GoldMind AI executes live XAUUSD trades through." },
      { property: "og:title", content: "Broker Connections · GoldMind AI" },
      { property: "og:description", content: "Securely link personal, funded and prop-firm accounts for automated gold execution." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

const money = (v: unknown, ccy = "USD") =>
  v == null ? "—" : `${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy}`;

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    connected: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    reauth_required: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    error: "bg-red-500/10 text-red-400 border-red-500/30",
    disconnected: "bg-muted text-muted-foreground border-border",
  };
  const label = status === "reauth_required" ? "Reauthorisation needed" : status;
  return (
    <span className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-full border ${map[status] ?? map["disconnected"]}`}>
      {label}
    </span>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm mt-0.5">{value}</div>
    </div>
  );
}

function BrokerConnectionsPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listBrokerConnections);
  const connectFn = useServerFn(connectBroker);
  const syncFn = useServerFn(syncBrokerConnection);
  const disconnectFn = useServerFn(disconnectBroker);
  const defaultFn = useServerFn(setDefaultBrokerConnection);

  const [picking, setPicking] = useState(false);
  const [selected, setSelected] = useState<BrokerSpec | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [label, setLabel] = useState("");

  const connections = useQuery({
    queryKey: ["broker-connections"],
    queryFn: () => listFn(),
    refetchInterval: 30_000,
  });

  const rows: any[] = Array.isArray(connections.data) ? connections.data : [];
  const invalidate = () => qc.invalidateQueries({ queryKey: ["broker-connections"] });

  const connect = useMutation({
    mutationFn: (payload: { broker_id: string; label?: string; credentials: Record<string, string> }) =>
      connectFn({ data: payload }),
    onSuccess: () => {
      toast.success("Broker connected");
      setSelected(null);
      setPicking(false);
      setForm({});
      setLabel("");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not connect broker"),
  });

  const sync = useMutation({
    mutationFn: (id: string) => syncFn({ data: { id } }),
    onSuccess: (res: any) => {
      if (res?.ok) toast.success("Account synchronised");
      else toast.error(res?.error ?? "Sync failed");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Sync failed"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => disconnectFn({ data: { id } }),
    onSuccess: () => { toast.success("Broker disconnected"); invalidate(); },
  });

  const makeDefault = useMutation({
    mutationFn: (id: string) => defaultFn({ data: { id } }),
    onSuccess: () => { toast.success("Default execution account updated"); invalidate(); },
  });

  const canSubmit = useMemo(() => {
    if (!selected) return false;
    return selected.fields.every((f) => f.optional || (form[f.key] ?? "").trim().length > 0);
  }, [selected, form]);

  return (
    <div className="p-5 md:p-8 space-y-6 max-w-6xl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold flex items-center gap-2">
            <Link2 className="h-5 w-5 text-[color:var(--gold)]" /> Broker Connections
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            GoldMind AI executes every live trade directly through your connected brokerage account.
            The TradingView chart is for analysis only and never places orders.
          </p>
        </div>
        <button
          onClick={() => { setPicking(true); setSelected(null); }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-[color:var(--gold-foreground)]"
          style={{ background: "var(--gradient-gold)" }}
        >
          <Plus className="h-4 w-4" /> Connect broker
        </button>
      </header>

      <div className="glass-panel rounded-xl p-4 flex items-start gap-3">
        <ShieldCheck className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Credentials are encrypted with AES-256-GCM on the server before storage and are never sent back to your browser.
          A connection stays authorised until you disconnect it or the broker revokes access — you never have to reconnect
          just because you signed out of GoldMind AI.
        </p>
      </div>

      {connections.isLoading ? (
        <div className="glass-panel rounded-xl p-10 flex justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="glass-panel rounded-xl p-10 text-center">
          <p className="text-sm text-muted-foreground">No broker accounts connected yet.</p>
          <button onClick={() => setPicking(true)} className="mt-4 text-sm text-[color:var(--gold)] hover:underline">
            Connect your first account
          </button>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map((c) => {
            const spec = brokerSpec(c.broker_id);
            return (
              <div key={c.id} className="glass-panel rounded-xl p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="h-10 w-10 rounded-lg flex items-center justify-center font-semibold text-sm text-background"
                      style={{ background: spec?.accentColor ?? "var(--gold)" }}
                    >
                      {spec?.monogram ?? "BR"}
                    </div>
                    <div>
                      <div className="font-medium text-sm flex items-center gap-2">
                        {c.label || spec?.name || c.broker_id}
                        {c.is_default && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[color:var(--gold)]/15 text-[color:var(--gold)]">
                            Default
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{spec?.name ?? c.broker_id}</div>
                    </div>
                  </div>
                  <StatusPill status={c.status} />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <Field label="Account" value={c.account_name ?? "—"} />
                  <Field label="Number" value={maskAccountNumber(c.account_number)} />
                  <Field label="Type" value={<span className={c.account_type === "live" ? "text-red-400" : "text-emerald-400"}>{String(c.account_type).toUpperCase()}</span>} />
                  <Field label="Balance" value={money(c.balance, c.currency)} />
                  <Field label="Equity" value={money(c.equity, c.currency)} />
                  <Field label="Free margin" value={money(c.free_margin, c.currency)} />
                  <Field label="Margin level" value={c.margin_level != null ? `${Number(c.margin_level).toFixed(1)}%` : "—"} />
                  <Field label="Open positions" value={c.open_positions ?? 0} />
                  <Field
                    label="Last sync"
                    value={c.last_sync_at ? new Date(c.last_sync_at).toLocaleTimeString() : "never"}
                  />
                </div>

                {c.last_error && (
                  <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span className="break-words">{c.last_error}</span>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    onClick={() => sync.mutate(c.id)}
                    disabled={sync.isPending}
                    className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-accent disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${sync.isPending ? "animate-spin" : ""}`} />
                    {c.status === "connected" ? "Sync" : "Reconnect"}
                  </button>
                  {!c.is_default && (
                    <button
                      onClick={() => makeDefault.mutate(c.id)}
                      className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-accent"
                    >
                      <Star className="h-3.5 w-3.5" /> Set as execution account
                    </button>
                  )}
                  <button
                    onClick={() => remove.mutate(c.id)}
                    className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Disconnect
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Connect flow */}
      {picking && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-start md:items-center justify-center p-4 overflow-y-auto">
          <div className="glass-panel rounded-2xl w-full max-w-xl p-6 space-y-5 my-8">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">
                {selected ? `Connect ${selected.name}` : "Choose a broker"}
              </h2>
              <button onClick={() => { setPicking(false); setSelected(null); }} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            {!selected ? (
              <div className="space-y-2">
                {BROKERS.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => { setSelected(b); setForm({}); }}
                    className="w-full text-left flex items-start gap-3 p-3 rounded-xl border border-border hover:bg-accent transition-colors"
                  >
                    <div
                      className="h-9 w-9 rounded-lg flex items-center justify-center font-semibold text-xs text-background shrink-0"
                      style={{ background: b.accentColor }}
                    >
                      {b.monogram}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium flex items-center gap-2">
                        {b.name}
                        {b.supportsPropFirms && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">Prop firm ready</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{b.description}</div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  connect.mutate({ broker_id: selected.id, label: label || undefined, credentials: form });
                }}
              >
                <div>
                  <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Nickname (optional)</label>
                  <input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Challenge account #2"
                    className="w-full px-3 py-2.5 rounded-lg bg-input border border-border text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--gold)]/40"
                  />
                </div>
                {selected.fields.map((f) => (
                  <div key={f.key}>
                    <label className="block text-xs font-medium mb-1.5 text-muted-foreground">
                      {f.label}{f.optional ? " (optional)" : ""}
                    </label>
                    {f.type === "select" ? (
                      <select
                        value={form[f.key] ?? f.options?.[0]?.value ?? ""}
                        onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded-lg bg-input border border-border text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--gold)]/40"
                      >
                        {f.options?.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={f.type}
                        value={form[f.key] ?? ""}
                        placeholder={f.placeholder}
                        onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded-lg bg-input border border-border text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--gold)]/40"
                      />
                    )}
                    {f.help && <p className="text-[11px] text-muted-foreground mt-1">{f.help}</p>}
                  </div>
                ))}

                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  GoldMind AI verifies these credentials with {selected.name} before saving them. Nothing is stored if
                  authorisation fails.
                </p>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    className="px-4 py-2 rounded-lg text-sm border border-border hover:bg-accent"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={!canSubmit || connect.isPending}
                    className="flex-1 py-2 rounded-lg text-sm font-medium text-[color:var(--gold-foreground)] disabled:opacity-50 inline-flex items-center justify-center gap-2"
                    style={{ background: "var(--gradient-gold)" }}
                  >
                    {connect.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                    {connect.isPending ? "Authorising…" : "Connect account"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
