import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FlaskConical, Play, Trash2, TrendingUp, ShieldAlert } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { runBacktestFn, listBacktestRuns, deleteBacktestRun, PERIODS_BY_TIMEFRAME } from "@/lib/backtest.functions";
import { FIDELITY_CAVEATS } from "@/lib/backtest/pipeline-adapter";

export const Route = createFileRoute("/_authenticated/backtesting")({
  component: BacktestingPage,
  head: () => ({
    meta: [
      { title: "Backtesting · GoldMind AI" },
      { name: "description", content: "Simulate the GoldMind AI XAUUSD strategy over historical gold data with full risk-engine enforcement and institutional performance metrics." },
      { property: "og:title", content: "Backtesting · GoldMind AI" },
      { property: "og:description", content: "Historical simulation of the GoldMind AI gold strategy with Sharpe, expectancy and drawdown analytics." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

const TIMEFRAMES = ["5", "15", "30", "60", "240"] as const;

const MODES = [
  {
    key: "pipeline" as const,
    label: "Real pipeline",
    blurb: "Replays the live decision engine — structure, multi-timeframe bias, setup models, confidence, safety checklist, risk sizing and position management.",
  },
  {
    key: "classic" as const,
    label: "Classic proxy",
    blurb: "The original rule-based EMA / RSI / ATR proxy strategy. Fast, but it is not the strategy the platform actually trades.",
  },
];

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="glass-panel rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${tone === "up" ? "text-emerald-400" : tone === "down" ? "text-red-400" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function BacktestingPage() {
  const qc = useQueryClient();
  const runFn = useServerFn(runBacktestFn);
  const listFn = useServerFn(listBacktestRuns);
  const delFn = useServerFn(deleteBacktestRun);

  const [mode, setMode] = useState<"pipeline" | "classic">("pipeline");
  const [timeframe, setTimeframe] = useState<(typeof TIMEFRAMES)[number]>("15");
  const periodOptions = PERIODS_BY_TIMEFRAME[timeframe] ?? ["1mo"];
  const [period, setPeriod] = useState<string>("1mo");
  const [startingBalance, setStartingBalance] = useState(10_000);
  const [riskPerTradePct, setRisk] = useState(0.5);
  const [rrTarget, setRr] = useState(2);
  const [atrStopMultiple, setAtrMult] = useState(1.5);
  const [minConfidence, setMinConfidence] = useState(88);
  const [costPerTrade, setCost] = useState(0.35);
  const [useTrailingStop, setTrail] = useState(true);
  const [londonNyOnly, setSessions] = useState(true);
  const [result, setResult] = useState<any | null>(null);

  const runs = useQuery({ queryKey: ["backtest-runs"], queryFn: () => listFn() });

  const run = useMutation({
    mutationFn: () =>
      runFn({
        data: {
          mode, timeframe, period: (periodOptions.includes(period) ? period : periodOptions[0]) as any,
          startingBalance, riskPerTradePct, rrTarget,
          atrStopMultiple, minConfidence, costPerTrade, useTrailingStop, londonNyOnly, save: true,
        },
      }),
    onSuccess: (res: any) => {
      if (!res?.ok) { toast.error(res?.reason ?? "Backtest failed"); return; }
      setResult(res);
      toast.success(`Simulated ${res.bars} bars in ${res.durationMs} ms`);
      qc.invalidateQueries({ queryKey: ["backtest-runs"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Backtest failed"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["backtest-runs"] }),
  });

  const m = result?.metrics;
  const curve: any[] = Array.isArray(result?.equityCurve) ? result.equityCurve : [];
  const trades: any[] = Array.isArray(result?.trades) ? result.trades.slice(-25).reverse() : [];
  const history: any[] = Array.isArray(runs.data) ? runs.data : [];

  return (
    <div className="p-5 md:p-8 space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-[color:var(--gold)]" /> Backtesting
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Replay the GoldMind strategy over historical gold candles. Every simulated order passes the same risk
          engine that guards live execution, so results reflect your actual limits.
        </p>
      </header>

      <div className="glass-panel rounded-xl p-5 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {MODES.map((mo) => (
            <button
              key={mo.key}
              type="button"
              onClick={() => setMode(mo.key)}
              className={`text-left rounded-lg border p-3 transition-colors ${
                mode === mo.key
                  ? "border-[color:var(--gold)] bg-[color:var(--gold)]/10"
                  : "border-border hover:border-muted-foreground/40"
              }`}
            >
              <div className="text-sm font-medium">{mo.label}</div>
              <p className="text-xs text-muted-foreground mt-1">{mo.blurb}</p>
            </button>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs space-y-1.5">
            <span className="text-muted-foreground">Timeframe</span>
            <select value={timeframe} onChange={(e) => {
                const tf = e.target.value as any;
                setTimeframe(tf);
                const opts = PERIODS_BY_TIMEFRAME[tf] ?? ["1mo"];
                if (!opts.includes(period)) setPeriod(opts[0]);
              }}
              className="w-full bg-background border border-border rounded-md px-2 py-2 text-sm">
              {TIMEFRAMES.map((t) => <option key={t} value={t}>{t === "240" ? "4h" : `${t}m`}</option>)}
            </select>
          </label>
          <label className="text-xs space-y-1.5">
            <span className="text-muted-foreground">History</span>
            <select value={period} onChange={(e) => setPeriod(e.target.value as any)}
              className="w-full bg-background border border-border rounded-md px-2 py-2 text-sm">
              {periodOptions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <span className="block text-[10px] text-muted-foreground">
              Capped to what the data provider serves at this interval.
            </span>
          </label>
          <label className="text-xs space-y-1.5">
            <span className="text-muted-foreground">Starting balance ($)</span>
            <input type="number" value={startingBalance} min={100} step={500}
              onChange={(e) => setStartingBalance(Number(e.target.value))}
              className="w-full bg-background border border-border rounded-md px-2 py-2 text-sm" />
          </label>
          <label className="text-xs space-y-1.5">
            <span className="text-muted-foreground">Risk per trade (%)</span>
            <input type="number" value={riskPerTradePct} min={0.1} max={2} step={0.1}
              onChange={(e) => setRisk(Number(e.target.value))}
              className="w-full bg-background border border-border rounded-md px-2 py-2 text-sm" />
          </label>
          <label className="text-xs space-y-1.5">
            <span className="text-muted-foreground">Reward : risk</span>
            <input type="number" value={rrTarget} min={1} max={6} step={0.5}
              onChange={(e) => setRr(Number(e.target.value))}
              className="w-full bg-background border border-border rounded-md px-2 py-2 text-sm" />
          </label>
          <label className="text-xs space-y-1.5">
            <span className="text-muted-foreground">ATR stop multiple</span>
            <input type="number" value={atrStopMultiple} min={0.5} max={5} step={0.1}
              onChange={(e) => setAtrMult(Number(e.target.value))}
              className="w-full bg-background border border-border rounded-md px-2 py-2 text-sm" />
          </label>
          <label className="text-xs space-y-1.5">
            <span className="text-muted-foreground">Min confidence (%)</span>
            <input type="number" value={minConfidence} min={50} max={99} step={1}
              onChange={(e) => setMinConfidence(Number(e.target.value))}
              className="w-full bg-background border border-border rounded-md px-2 py-2 text-sm" />
          </label>
          <label className="text-xs space-y-1.5">
            <span className="text-muted-foreground">Cost per trade ($/oz)</span>
            <input type="number" value={costPerTrade} min={0} max={5} step={0.05}
              onChange={(e) => setCost(Number(e.target.value))}
              className="w-full bg-background border border-border rounded-md px-2 py-2 text-sm" />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={useTrailingStop} onChange={(e) => setTrail(e.target.checked)} />
            Break-even + ATR trailing stop
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={londonNyOnly} onChange={(e) => setSessions(e.target.checked)} />
            London / New York sessions only
          </label>
          <button onClick={() => run.mutate()} disabled={run.isPending}
            className="ml-auto inline-flex items-center gap-2 rounded-md bg-[color:var(--gold)] text-black px-4 py-2 text-sm font-medium disabled:opacity-60">
            <Play className="h-4 w-4" /> {run.isPending ? "Simulating…" : "Run backtest"}
          </button>
        </div>
      </div>

      {mode === "pipeline" && (
        <div className="glass-panel rounded-xl p-4 border border-amber-500/30">
          <h2 className="text-sm font-medium flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-400" /> Replay fidelity
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            The deterministic majority of the live system runs unchanged. These parts cannot be reconstructed
            from history and are neutralised, so results are indicative of structure and risk behaviour, not of
            fundamentals-aware live performance.
          </p>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground list-disc pl-4">
            {(Array.isArray(result?.caveats) ? result.caveats : FIDELITY_CAVEATS).map((c: string) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {m && (
        <>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-6">
            <Stat label="Net P&L" value={`$${m.netPnl.toLocaleString()}`} tone={m.netPnl >= 0 ? "up" : "down"} />
            <Stat label="Return" value={`${m.returnPct}%`} tone={m.returnPct >= 0 ? "up" : "down"} />
            <Stat label="Trades" value={String(m.trades)} />
            <Stat label="Win rate" value={`${m.winRate}%`} />
            <Stat label="Profit factor" value={String(m.profitFactor)} tone={m.profitFactor >= 1.3 ? "up" : "down"} />
            <Stat label="Expectancy" value={`${m.expectancyR}R`} tone={m.expectancyR >= 0 ? "up" : "down"} />
            <Stat label="Max drawdown" value={`${m.maxDrawdownPct}%`} tone="down" />
            <Stat label="Sharpe" value={String(m.sharpe)} />
            <Stat label="Sortino" value={String(m.sortino)} />
            <Stat label="Avg win" value={`$${m.avgWin}`} tone="up" />
            <Stat label="Avg loss" value={`$${m.avgLoss}`} tone="down" />
            <Stat label="Blocked by risk" value={String(m.blockedByRisk)} />
          </div>

          {result?.mode === "pipeline" && (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="glass-panel rounded-xl p-4">
                <h2 className="text-sm font-medium mb-2">Why the pipeline declined</h2>
                <p className="text-[11px] text-muted-foreground mb-2">
                  {result.candidateBars} bars produced a named setup candidate; {result.approvedBars} were approved.
                </p>
                <ul className="space-y-1 text-xs">
                  {(result.rejections ?? []).map((r: any) => (
                    <li key={r.reason} className="flex justify-between gap-3">
                      <span className="text-muted-foreground truncate">{r.reason}</span>
                      <span className="tabular-nums">{r.count}</span>
                    </li>
                  ))}
                  {(result.rejections ?? []).length === 0 && (
                    <li className="text-muted-foreground">No candidates were rejected.</li>
                  )}
                </ul>
                {result.confidence?.samples > 0 && (
                  <div className="mt-3 border-t border-border/50 pt-3 text-[11px] text-muted-foreground space-y-1">
                    <div className="flex justify-between gap-3">
                      <span>Deterministic confidence on candidates</span>
                      <span className="tabular-nums text-foreground">
                        median {result.confidence.median}% · p90 {result.confidence.p90}% · max {result.confidence.max}%
                      </span>
                    </div>
                    {result.confidence.max < 88 && (
                      <p>
                        Every candidate stayed below the live 88% gate, so no trade was taken. In replay the AI
                        conviction, macro and correlation pillars are neutralised, which caps the achievable score —
                        this measures the deterministic engine, not the live system's full confidence.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="glass-panel rounded-xl p-4">
                <h2 className="text-sm font-medium mb-2">Setup models traded</h2>
                <ul className="space-y-1 text-xs">
                  {(result.models ?? []).map((mm: any) => (
                    <li key={mm.model} className="flex justify-between gap-3">
                      <span className="text-muted-foreground">{mm.model.replaceAll("_", " ").toLowerCase()}</span>
                      <span className="tabular-nums">{mm.trades}</span>
                    </li>
                  ))}
                  {(result.models ?? []).length === 0 && (
                    <li className="text-muted-foreground">No trades were taken.</li>
                  )}
                </ul>
                {Array.isArray(result.missingTimeframes) && result.missingTimeframes.length > 0 && (
                  <p className="text-[11px] text-muted-foreground mt-3">
                    Timeframes unavailable in replay: {result.missingTimeframes.join(", ")}
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="glass-panel rounded-xl p-4">
            <h2 className="text-sm font-medium flex items-center gap-2 mb-3">
              <TrendingUp className="h-4 w-4 text-[color:var(--gold)]" /> Equity curve
            </h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={curve}>
                  <defs>
                    <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--gold)" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="var(--gold)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="t" tick={{ fontSize: 10 }} tickFormatter={(t) => new Date(t).toLocaleDateString()} minTickGap={40} />
                  <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} width={60} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }}
                    labelFormatter={(t) => new Date(Number(t)).toLocaleString()}
                    formatter={(v: any) => [`$${Number(v).toLocaleString()}`, "Equity"]}
                  />
                  <Area type="monotone" dataKey="equity" stroke="var(--gold)" fill="url(#eq)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="glass-panel rounded-xl p-4 overflow-x-auto">
            <h2 className="text-sm font-medium mb-3">Most recent simulated trades</h2>
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="py-1.5 pr-3">Opened</th><th className="pr-3">Side</th><th className="pr-3">Entry</th>
                  <th className="pr-3">Exit</th><th className="pr-3">Lots</th><th className="pr-3">R</th>
                  <th className="pr-3">P&L</th><th className="pr-3">Exit reason</th><th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t, i) => (
                  <tr key={i} className="border-t border-border/50">
                    <td className="py-1.5 pr-3 whitespace-nowrap">{new Date(t.openedAt).toLocaleString()}</td>
                    <td className={`pr-3 ${t.direction === "BUY" ? "text-emerald-400" : "text-red-400"}`}>{t.direction}</td>
                    <td className="pr-3 tabular-nums">{t.entry.toFixed(2)}</td>
                    <td className="pr-3 tabular-nums">{t.exit.toFixed(2)}</td>
                    <td className="pr-3 tabular-nums">{t.lots}</td>
                    <td className="pr-3 tabular-nums">{t.rMultiple}</td>
                    <td className={`pr-3 tabular-nums ${t.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>${t.pnl}</td>
                    <td className="pr-3">{t.exitReason}</td>
                    <td className="tabular-nums">{t.confidence}%</td>
                  </tr>
                ))}
                {!trades.length && (
                  <tr><td colSpan={9} className="py-3 text-muted-foreground">No trades were taken with these settings.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!m && !run.isPending && (
        <div className="glass-panel rounded-xl p-5 flex items-start gap-3 text-xs text-muted-foreground">
          <ShieldAlert className="h-4 w-4 text-[color:var(--gold)] mt-0.5 shrink-0" />
          <p>
            Backtests use bar-level fills with the pessimistic assumption that a stop is hit before a target when
            both fall inside the same candle. Costs are applied to every round trip. Treat results as a filter for
            bad configurations, not a promise of future returns.
          </p>
        </div>
      )}

      <div className="glass-panel rounded-xl p-4">
        <h2 className="text-sm font-medium mb-3">Saved runs</h2>
        <div className="space-y-2">
          {history.map((r) => (
            <div key={r.id} className="flex items-center gap-3 text-xs border-t border-border/50 pt-2 first:border-0 first:pt-0">
              <div className="flex-1">
                <div className="font-medium">{r.label}</div>
                <div className="text-muted-foreground">{new Date(r.created_at).toLocaleString()} · {r.bars} bars</div>
              </div>
              <div className="tabular-nums">{r.metrics?.trades ?? 0} trades</div>
              <div className={`tabular-nums ${(r.metrics?.returnPct ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {r.metrics?.returnPct ?? 0}%
              </div>
              <div className="tabular-nums text-muted-foreground">PF {r.metrics?.profitFactor ?? "—"}</div>
              <button onClick={() => remove.mutate(r.id)} className="text-muted-foreground hover:text-red-400" aria-label="Delete run">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {!history.length && <div className="text-xs text-muted-foreground">No saved runs yet.</div>}
        </div>
      </div>
    </div>
  );
}
