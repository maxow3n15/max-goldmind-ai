import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Trophy, ShieldAlert, Target, Activity, Gauge, Plus, Trash2, CheckCircle2, XCircle } from "lucide-react";
import {
  listChallengeProfiles, saveChallengeProfile, deleteChallengeProfile, getChallengeStatus,
} from "@/lib/challenge.functions";
import { CHALLENGE_PRESETS, PHASES, presetByKey, rulesFor, type ChallengePhase } from "@/lib/challenge/presets";
import { fmtUsd } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/challenge")({
  component: ChallengePage,
  head: () => ({
    meta: [
      { title: "Funded Challenge · GoldMind AI" },
      { name: "description", content: "Track prop-firm challenge objectives, daily and maximum drawdown headroom, consistency rules and modelled pass probability, with the AI adapting its risk automatically." },
      { property: "og:title", content: "Funded Challenge · GoldMind AI" },
      { property: "og:description", content: "Challenge compliance, account health and pass-probability modelling for funded XAUUSD accounts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

type Form = {
  id: string | null;
  label: string;
  provider: string;
  preset_key: string;
  phase: ChallengePhase;
  account_size: number;
  currency: string;
  profit_target_pct: number;
  daily_loss_limit_pct: number;
  max_drawdown_pct: number;
  drawdown_type: "static" | "trailing" | "eod_trailing";
  drawdown_basis: "equity" | "balance";
  daily_loss_basis: "balance" | "equity";
  consistency_rule_pct: number | null;
  min_trading_days: number;
  max_trading_days: number | null;
  news_restriction_minutes: number;
  weekend_holding_allowed: boolean;
  overnight_holding_allowed: boolean;
  max_lot_size: number | null;
  daily_reset_utc_hour: number;
  start_balance: number;
  status: "active" | "passed" | "failed" | "paused";
  auto_enforce: boolean;
  safety_buffer_pct: number;
  notes: string | null;
};

function blankForm(presetKey = "ftmo", phase: ChallengePhase = "evaluation_1", size = 100000): Form {
  const p = presetByKey(presetKey);
  const r = rulesFor(presetKey, phase);
  return {
    id: null,
    label: `${p.provider} ${size / 1000}k`,
    provider: p.provider,
    preset_key: p.key,
    phase,
    account_size: size,
    currency: "USD",
    start_balance: size,
    status: "active",
    auto_enforce: true,
    safety_buffer_pct: 20,
    max_lot_size: null,
    notes: null,
    ...r,
  };
}

function Field({ label, hint, children }: { label: string; hint?: string; children: any }) {
  return (
    <label className="text-xs space-y-1.5 block">
      <span className="text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-muted-foreground/80">{hint}</span>}
    </label>
  );
}

const input = "w-full bg-background border border-border rounded-md px-2 py-2 text-sm";

function Meter({ label, usedPct, danger, caption }: { label: string; usedPct: number; danger?: boolean; caption: string }) {
  const pct = Math.max(0, Math.min(100, usedPct));
  const color = pct >= 80 ? "var(--destructive)" : pct >= 50 ? "#f59e0b" : "var(--gold)";
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className={danger ? "text-destructive" : "text-muted-foreground"}>{label}</span>
        <span className="font-medium tabular-nums">{pct.toFixed(0)}%</span>
      </div>
      <div className="h-2 rounded-full bg-border/60 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="text-[10px] text-muted-foreground">{caption}</div>
    </div>
  );
}

function ChallengePage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listChallengeProfiles);
  const saveFn = useServerFn(saveChallengeProfile);
  const delFn = useServerFn(deleteChallengeProfile);
  const statusFn = useServerFn(getChallengeStatus);

  const profiles = useQuery({ queryKey: ["challenge-profiles"], queryFn: () => listFn() });
  const rows: any[] = Array.isArray(profiles.data) ? profiles.data : [];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Form>(() => blankForm());

  useEffect(() => {
    if (!selectedId && rows.length) setSelectedId(rows[0].id);
  }, [rows, selectedId]);

  const status = useQuery({
    queryKey: ["challenge-status", selectedId],
    queryFn: () => statusFn({ data: { id: selectedId } }),
    enabled: rows.length > 0,
    refetchInterval: 30_000,
  });

  const save = useMutation({
    mutationFn: () => saveFn({ data: form as any }),
    onSuccess: (row: any) => {
      toast.success("Challenge account saved");
      setEditing(false);
      setSelectedId(row?.id ?? null);
      qc.invalidateQueries({ queryKey: ["challenge-profiles"] });
      qc.invalidateQueries({ queryKey: ["challenge-status"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not save the challenge account"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Challenge account removed");
      setSelectedId(null);
      qc.invalidateQueries({ queryKey: ["challenge-profiles"] });
    },
  });

  const applyPreset = (key: string, phase: ChallengePhase, size: number) => {
    const p = presetByKey(key);
    const r = rulesFor(key, phase);
    setForm((f) => ({
      ...f, ...r,
      preset_key: p.key,
      provider: p.provider,
      phase,
      account_size: size,
      start_balance: f.id ? f.start_balance : size,
      label: f.id ? f.label : `${p.provider} ${Math.round(size / 1000)}k`,
    }));
  };

  const st: any = status.data?.status ?? null;
  const profile: any = status.data?.profile ?? null;
  const days: any[] = Array.isArray(status.data?.days) ? status.data!.days : [];

  const postureCopy: Record<string, string> = {
    push: "Conditions allow full risk.",
    normal: "Standard risk. Every objective has healthy headroom.",
    conservative: "Reduced size — protecting headroom is worth more than another trade.",
    lockdown: "Trading blocked on this account until the limits reset.",
  };

  const equityCurve = useMemo(() => {
    let run = Number(profile?.start_balance ?? 0);
    return days.map((d: any) => { run = Number(d.start_equity) + Number(d.pnl); return { day: d.day, equity: run }; });
  }, [days, profile]);

  return (
    <div className="p-5 md:p-8 space-y-6 max-w-6xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold flex items-center gap-2">
            <Trophy className="h-5 w-5 text-[color:var(--gold)]" /> Funded Challenge
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Configure the rules of an evaluation or funded account and the engine enforces them on top of the existing
            risk engine — whichever limit is stricter always wins. Nothing is ever traded that could breach an objective.
          </p>
        </div>
        <button
          onClick={() => { setForm(blankForm()); setEditing(true); }}
          className="inline-flex items-center gap-1.5 rounded-md bg-[color:var(--gold)] text-black px-3 py-2 text-sm font-medium"
        >
          <Plus className="h-4 w-4" /> Add account
        </button>
      </header>

      {rows.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {rows.map((p) => (
            <button key={p.id} onClick={() => { setSelectedId(p.id); setEditing(false); }}
              className={`rounded-lg border px-3 py-2 text-xs transition-colors ${
                selectedId === p.id ? "border-[color:var(--gold)] text-[color:var(--gold)]" : "border-border hover:bg-accent"
              }`}>
              <span className="font-medium">{p.label}</span>
              <span className="block text-[10px] text-muted-foreground">
                {p.provider} · {String(p.phase).replace("_", " ")} · {p.status}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* ---------------- Onboarding / editing ---------------- */}
      {(editing || rows.length === 0) && (
        <section className="glass-panel rounded-xl p-5 space-y-5">
          <div>
            <h2 className="text-sm font-medium">{form.id ? "Edit challenge account" : "New challenge account"}</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Pick the closest provider preset, then correct anything that differs from your account dashboard. The
              presets are starting points — the saved values are what gets enforced.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {CHALLENGE_PRESETS.map((p) => (
              <button key={p.key} onClick={() => applyPreset(p.key, form.phase, form.account_size)}
                className={`text-left rounded-lg border p-3 text-xs transition-colors ${
                  form.preset_key === p.key ? "border-[color:var(--gold)]" : "border-border hover:bg-accent"
                }`}>
                <div className="font-medium">{p.label}</div>
                <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">{p.note}</p>
              </button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Account label">
              <input className={input} value={form.label} maxLength={80}
                onChange={(e) => setForm({ ...form, label: e.target.value })} />
            </Field>
            <Field label="Phase">
              <select className={input} value={form.phase}
                onChange={(e) => applyPreset(form.preset_key, e.target.value as ChallengePhase, form.account_size)}>
                {PHASES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </Field>
            <Field label="Account size" hint="The provider's nominal account size — all percentages are measured against it.">
              <input type="number" className={input} min={1000} step={1000} value={form.account_size}
                onChange={(e) => setForm({ ...form, account_size: Number(e.target.value), start_balance: Number(e.target.value) })} />
            </Field>
            <Field label="Current start balance" hint="Balance at the start of this phase, if it differs from the account size.">
              <input type="number" className={input} min={1} step={100} value={form.start_balance}
                onChange={(e) => setForm({ ...form, start_balance: Number(e.target.value) })} />
            </Field>
            <Field label="Profit target (%)" hint="Set 0 for a funded account with no target.">
              <input type="number" className={input} min={0} max={100} step={0.5} value={form.profit_target_pct}
                onChange={(e) => setForm({ ...form, profit_target_pct: Number(e.target.value) })} />
            </Field>
            <Field label="Daily loss limit (%)">
              <input type="number" className={input} min={0.1} max={100} step={0.5} value={form.daily_loss_limit_pct}
                onChange={(e) => setForm({ ...form, daily_loss_limit_pct: Number(e.target.value) })} />
            </Field>
            <Field label="Maximum loss (%)">
              <input type="number" className={input} min={0.1} max={100} step={0.5} value={form.max_drawdown_pct}
                onChange={(e) => setForm({ ...form, max_drawdown_pct: Number(e.target.value) })} />
            </Field>
            <Field label="Maximum-loss type" hint="Trailing limits follow your highest equity, so giving profit back also counts.">
              <select className={input} value={form.drawdown_type}
                onChange={(e) => setForm({ ...form, drawdown_type: e.target.value as Form["drawdown_type"] })}>
                <option value="static">Static (from initial balance)</option>
                <option value="trailing">Trailing (from peak equity)</option>
                <option value="eod_trailing">Trailing end-of-day balance</option>
              </select>
            </Field>
            <Field label="Daily loss measured on">
              <select className={input} value={form.daily_loss_basis}
                onChange={(e) => setForm({ ...form, daily_loss_basis: e.target.value as Form["daily_loss_basis"] })}>
                <option value="balance">Start-of-day balance</option>
                <option value="equity">Start-of-day equity</option>
              </select>
            </Field>
            <Field label="Daily reset hour (UTC)" hint="When the provider resets the daily loss limit.">
              <input type="number" className={input} min={0} max={23} step={1} value={form.daily_reset_utc_hour}
                onChange={(e) => setForm({ ...form, daily_reset_utc_hour: Number(e.target.value) })} />
            </Field>
            <Field label="Consistency rule (%)" hint="Maximum share of total profit any single day may contribute. Blank if none.">
              <input type="number" className={input} min={1} max={100} step={1} value={form.consistency_rule_pct ?? ""}
                onChange={(e) => setForm({ ...form, consistency_rule_pct: e.target.value === "" ? null : Number(e.target.value) })} />
            </Field>
            <Field label="Minimum trading days">
              <input type="number" className={input} min={0} max={365} step={1} value={form.min_trading_days}
                onChange={(e) => setForm({ ...form, min_trading_days: Number(e.target.value) })} />
            </Field>
            <Field label="Maximum days" hint="Blank for unlimited-time evaluations.">
              <input type="number" className={input} min={1} max={365} step={1} value={form.max_trading_days ?? ""}
                onChange={(e) => setForm({ ...form, max_trading_days: e.target.value === "" ? null : Number(e.target.value) })} />
            </Field>
            <Field label="News restriction (± minutes)" hint="No entries inside this window around a high-impact release.">
              <input type="number" className={input} min={0} max={240} step={1} value={form.news_restriction_minutes}
                onChange={(e) => setForm({ ...form, news_restriction_minutes: Number(e.target.value) })} />
            </Field>
            <Field label="Lot cap" hint="Provider's maximum combined lot size. Blank if none.">
              <input type="number" className={input} min={0.01} step={0.01} value={form.max_lot_size ?? ""}
                onChange={(e) => setForm({ ...form, max_lot_size: e.target.value === "" ? null : Number(e.target.value) })} />
            </Field>
            <Field label="Safety buffer (%)" hint="Share of every limit the AI deliberately leaves untouched as margin for error.">
              <input type="number" className={input} min={0} max={60} step={5} value={form.safety_buffer_pct}
                onChange={(e) => setForm({ ...form, safety_buffer_pct: Number(e.target.value) })} />
            </Field>
            <Field label="Status">
              <select className={input} value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as Form["status"] })}>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="passed">Passed</option>
                <option value="failed">Failed</option>
              </select>
            </Field>
          </div>

          <div className="flex flex-wrap gap-4">
            <label className="flex items-start gap-2 text-xs">
              <input type="checkbox" className="mt-0.5" checked={form.overnight_holding_allowed}
                onChange={(e) => setForm({ ...form, overnight_holding_allowed: e.target.checked })} />
              <span>Overnight holding allowed</span>
            </label>
            <label className="flex items-start gap-2 text-xs">
              <input type="checkbox" className="mt-0.5" checked={form.weekend_holding_allowed}
                onChange={(e) => setForm({ ...form, weekend_holding_allowed: e.target.checked })} />
              <span>Weekend holding allowed</span>
            </label>
            <label className="flex items-start gap-2 text-xs">
              <input type="checkbox" className="mt-0.5" checked={form.auto_enforce}
                onChange={(e) => setForm({ ...form, auto_enforce: e.target.checked })} />
              <span>
                Enforce automatically
                <span className="block text-[10px] text-muted-foreground">The AI adapts its sizing and blocks trades that risk a breach.</span>
              </span>
            </label>
          </div>

          <div className="flex gap-2">
            <button onClick={() => save.mutate()} disabled={save.isPending}
              className="rounded-md bg-[color:var(--gold)] text-black px-4 py-2 text-sm font-medium disabled:opacity-60">
              {save.isPending ? "Saving…" : form.id ? "Save changes" : "Create challenge account"}
            </button>
            {rows.length > 0 && (
              <button onClick={() => setEditing(false)} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent">
                Cancel
              </button>
            )}
          </div>
        </section>
      )}

      {/* ---------------- Live compliance dashboard ---------------- */}
      {st && profile && !editing && (
        <>
          <section className="grid gap-4 md:grid-cols-4">
            <div className="glass-panel rounded-xl p-4">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Pass probability</div>
              <div className="text-3xl font-display font-semibold mt-1 tabular-nums">{st.passProbability}%</div>
              <div className="text-[10px] text-muted-foreground mt-1">Modelled from survival room, progress and realised expectancy.</div>
            </div>
            <div className="glass-panel rounded-xl p-4">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Account health</div>
              <div className="text-3xl font-display font-semibold mt-1 tabular-nums">{st.health}</div>
              <div className="text-[10px] text-muted-foreground mt-1">100 = every limit untouched.</div>
            </div>
            <div className="glass-panel rounded-xl p-4">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Posture</div>
              <div className={`text-lg font-display font-semibold mt-1 capitalize ${st.posture === "lockdown" ? "text-destructive" : ""}`}>
                {st.posture}
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">{postureCopy[st.posture]}</div>
            </div>
            <div className="glass-panel rounded-xl p-4">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Next-trade risk cap</div>
              <div className="text-3xl font-display font-semibold mt-1 tabular-nums">{st.maxRiskPctForNextTrade}%</div>
              <div className="text-[10px] text-muted-foreground mt-1">Size multiplier ×{st.sizeMultiplier}</div>
            </div>
          </section>

          <section className="glass-panel rounded-xl p-5 space-y-5">
            <h2 className="text-sm font-medium flex items-center gap-2">
              <Gauge className="h-4 w-4 text-[color:var(--gold)]" /> Objectives and limits
            </h2>
            <div className="grid gap-5 md:grid-cols-3">
              <Meter label="Profit target progress"
                usedPct={Math.max(0, st.profit.progressPct)}
                caption={`${fmtUsd(st.profit.earned)} of ${fmtUsd(st.profit.target)} · ${fmtUsd(st.profit.remaining)} to go`} />
              <Meter label="Daily loss used" danger={st.daily.usedPct >= 80} usedPct={st.daily.usedPct}
                caption={`${fmtUsd(st.daily.used)} of ${fmtUsd(st.daily.limit)} · ${fmtUsd(st.daily.remaining)} left today`} />
              <Meter label="Maximum loss used" danger={st.drawdown.usedPct >= 80} usedPct={st.drawdown.usedPct}
                caption={`Floor ${fmtUsd(st.drawdown.floorEquity)} · ${fmtUsd(st.drawdown.remaining)} of headroom (${st.drawdown.type.replace("_", "-")})`} />
            </div>
            <div className="grid gap-4 sm:grid-cols-3 text-xs">
              <div className="rounded-lg border border-border p-3">
                <div className="text-muted-foreground text-[10px] uppercase tracking-widest">Consistency</div>
                <div className="mt-1">
                  {st.consistency.limitPct == null
                    ? "No consistency rule on this account"
                    : `Best day is ${st.consistency.bestDaySharePct.toFixed(0)}% of total profit (limit ${st.consistency.limitPct}%)`}
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-muted-foreground text-[10px] uppercase tracking-widest">Trading days</div>
                <div className="mt-1">
                  {st.tradingDays.completed} completed{st.tradingDays.required > 0 ? ` of ${st.tradingDays.required} required` : ""}
                  {st.tradingDays.remainingCalendar != null ? ` · ${st.tradingDays.remainingCalendar} days left` : ""}
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-muted-foreground text-[10px] uppercase tracking-widest">Enforcement</div>
                <div className="mt-1">{profile.auto_enforce ? "Automatic — the engine adapts and blocks" : "Monitoring only"}</div>
              </div>
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <div className="glass-panel rounded-xl p-5 space-y-3">
              <h2 className="text-sm font-medium flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-[color:var(--gold)]" /> Compliance gates
              </h2>
              <ul className="space-y-1.5">
                {(st.gates ?? []).map((g: any) => (
                  <li key={g.key} className="flex items-start gap-2 text-xs">
                    {g.passed
                      ? <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-emerald-500 shrink-0" />
                      : <XCircle className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${g.hard ? "text-destructive" : "text-amber-500"}`} />}
                    <span className={g.passed ? "text-muted-foreground" : ""}>
                      {g.label}
                      {g.detail && <span className="text-muted-foreground"> — {g.detail}</span>}
                      {!g.passed && !g.hard && <span className="text-amber-500"> (warning)</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="glass-panel rounded-xl p-5 space-y-3">
              <h2 className="text-sm font-medium flex items-center gap-2">
                <Target className="h-4 w-4 text-[color:var(--gold)]" /> How the AI is adapting
              </h2>
              {st.notes.length === 0 && st.blockers.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  All objectives have healthy headroom — the engine is running at its normal risk profile.
                </p>
              ) : (
                <ul className="space-y-1.5 text-xs">
                  {st.blockers.map((b: string) => (
                    <li key={b} className="text-destructive">Blocked: {b}</li>
                  ))}
                  {st.warnings.map((w: string) => (
                    <li key={w} className="text-amber-500">Caution: {w}</li>
                  ))}
                  {st.notes.map((n: string) => (
                    <li key={n} className="text-muted-foreground">{n}</li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="glass-panel rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-medium flex items-center gap-2">
              <Activity className="h-4 w-4 text-[color:var(--gold)]" /> Daily history
            </h2>
            {equityCurve.length === 0 ? (
              <p className="text-xs text-muted-foreground">No closed trades since this account started.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="text-left">
                      <th className="py-1.5 font-normal">Day</th>
                      <th className="py-1.5 font-normal">Trades</th>
                      <th className="py-1.5 font-normal">P&amp;L</th>
                      <th className="py-1.5 font-normal">Lowest equity</th>
                      <th className="py-1.5 font-normal">Closing equity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...days].reverse().map((d: any) => (
                      <tr key={d.day} className="border-t border-border/60">
                        <td className="py-1.5">{d.day}</td>
                        <td className="py-1.5">{d.trades}</td>
                        <td className={`py-1.5 tabular-nums ${Number(d.pnl) >= 0 ? "text-emerald-500" : "text-destructive"}`}>
                          {fmtUsd(Number(d.pnl))}
                        </td>
                        <td className="py-1.5 tabular-nums">{fmtUsd(Number(d.low_equity))}</td>
                        <td className="py-1.5 tabular-nums">{fmtUsd(Number(d.start_equity) + Number(d.pnl))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="flex gap-2">
            <button
              onClick={() => { setForm({ ...(profile as any), id: profile.id } as Form); setEditing(true); }}
              className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent">
              Edit rules
            </button>
            <button
              onClick={() => { if (confirm("Remove this challenge account?")) remove.mutate(profile.id); }}
              className="inline-flex items-center gap-1.5 rounded-md border border-destructive/50 text-destructive px-4 py-2 text-sm hover:bg-destructive/10">
              <Trash2 className="h-4 w-4" /> Remove
            </button>
          </div>
        </>
      )}
    </div>
  );
}
