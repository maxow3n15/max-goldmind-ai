import { createFileRoute, useServerFn } from "@tanstack/react-router";
import { useServerFn as useSFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { TradingViewChart } from "@/components/TradingViewChart";
import { StatCard } from "@/components/StatCard";
import { analyzeMarket } from "@/lib/ai.functions";
import { openPaperTrade, getAccountSnapshot, listTrades, closePaperTrade } from "@/lib/trades.functions";
import { currentSession, fmtNum, fmtPct, fmtUsd } from "@/lib/format";
import { toast } from "sonner";
import { Activity, Brain, Clock, TrendingUp, TrendingDown, Wallet, Layers, Target, X, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
  head: () => ({
    meta: [
      { title: "Dashboard · GoldMind AI" },
      { name: "description", content: "Live XAUUSD dashboard: AI setups, session context, open trades and P&L." },
    ],
  }),
});

const TIMEFRAMES = [
  { v: "1", label: "1m" }, { v: "5", label: "5m" }, { v: "15", label: "15m" },
  { v: "30", label: "30m" }, { v: "60", label: "1H" }, { v: "240", label: "4H" }, { v: "D", label: "1D" },
] as const;

function Dashboard() {
  const [timeframe, setTimeframe] = useState<(typeof TIMEFRAMES)[number]["v"]>("15");
  const session = useMemo(() => currentSession(), []);
  const qc = useQueryClient();

  const analyzeFn = useSFn(analyzeMarket);
  const openFn = useSFn(openPaperTrade);
  const closeFn = useSFn(closePaperTrade);
  const acctFn = useSFn(getAccountSnapshot);
  const tradesFn = useSFn(listTrades);

  const snapshot = useQuery({ queryKey: ["snapshot"], queryFn: () => acctFn() });
  const trades = useQuery({ queryKey: ["trades"], queryFn: () => tradesFn() });

  const analyze = useMutation({
    mutationFn: () => analyzeFn({ data: { timeframe, session } }),
    onError: (e: any) => toast.error(e?.message ?? "Analysis failed"),
    onSuccess: () => toast.success("Analysis complete"),
  });

  const openTrade = useMutation({
    mutationFn: async () => {
      const a = analyze.data;
      if (!a?.setup) throw new Error("No setup available yet — run analysis first.");
      return openFn({ data: {
        direction: a.setup.direction,
        entry_price: a.setup.entry,
        stop_loss: a.setup.stop_loss,
        take_profit_1: a.setup.take_profit_1,
        take_profit_2: a.setup.take_profit_2,
        take_profit_3: a.setup.take_profit_3,
        lot_size: 0.1,
        confidence: a.confidence,
        timeframe, session,
        reason_entry: a.explanation,
        ai_analysis: a,
      } });
    },
    onSuccess: () => {
      toast.success("Paper trade opened");
      qc.invalidateQueries({ queryKey: ["trades"] });
      qc.invalidateQueries({ queryKey: ["snapshot"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to open trade"),
  });

  const closeTrade = useMutation({
    mutationFn: (id: string) => {
      const t = trades.data?.find((x: any) => x.id === id);
      if (!t) throw new Error("Trade missing");
      // Close at current entry price as an approximation for demo
      return closeFn({ data: { id, exit_price: Number(t.entry_price), reason_exit: "Closed manually from dashboard" } });
    },
    onSuccess: (d: any) => {
      toast.success(`Closed. P&L ${fmtUsd(d?.pnl)}`);
      qc.invalidateQueries({ queryKey: ["trades"] });
      qc.invalidateQueries({ queryKey: ["snapshot"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Close failed"),
  });

  const setup = analyze.data;
  const openTrades = (trades.data ?? []).filter((t: any) => t.status === "open");

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1600px] mx-auto">
      <header className="flex items-start md:items-center justify-between flex-col md:flex-row gap-3">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-semibold">Trading Desk</h1>
          <p className="text-sm text-muted-foreground mt-1 flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5"><Activity className="h-3.5 w-3.5" /> XAUUSD</span>
            <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> {session} session · UTC {new Date().toISOString().slice(11, 16)}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs gold-border text-[color:var(--gold)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--gold)] ticker-pulse" /> Paper mode
          </span>
        </div>
      </header>

      {/* Top stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <StatCard label="Balance" tone="gold" icon={<Wallet className="h-3.5 w-3.5" />}
          value={fmtUsd(Number(snapshot.data?.account?.balance ?? 0))} />
        <StatCard label="Equity" value={fmtUsd(Number(snapshot.data?.account?.equity ?? 0))} />
        <StatCard label="Free margin" value={fmtUsd(Number(snapshot.data?.account?.free_margin ?? 0))} />
        <StatCard label="Daily P&L" tone={(snapshot.data?.daily_pnl ?? 0) >= 0 ? "success" : "danger"}
          value={fmtUsd(snapshot.data?.daily_pnl ?? 0)} />
        <StatCard label="Weekly P&L" tone={(snapshot.data?.weekly_pnl ?? 0) >= 0 ? "success" : "danger"}
          value={fmtUsd(snapshot.data?.weekly_pnl ?? 0)} />
        <StatCard label="Win rate" value={fmtPct(snapshot.data?.win_rate ?? 0)} hint={`${snapshot.data?.closed_count ?? 0} closed · ${snapshot.data?.open_count ?? 0} open`} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Chart */}
        <div className="lg:col-span-2 glass-panel rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="font-display text-lg font-semibold">XAUUSD · TradingView</h2>
            <div className="flex gap-1 p-1 bg-secondary rounded-lg">
              {TIMEFRAMES.map((t) => (
                <button key={t.v} onClick={() => setTimeframe(t.v)}
                  className={`px-2.5 py-1 text-xs rounded-md font-mono transition-colors ${timeframe === t.v ? "bg-[color:var(--gold)] text-[color:var(--gold-foreground)]" : "text-muted-foreground hover:text-foreground"}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <TradingViewChart interval={timeframe} height={540} />
        </div>

        {/* AI panel */}
        <div className="glass-panel rounded-2xl p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg flex items-center justify-center gold-border">
                <Brain className="h-4 w-4 text-[color:var(--gold)]" />
              </div>
              <h2 className="font-display text-lg font-semibold">AI Setup</h2>
            </div>
            <button onClick={() => analyze.mutate()} disabled={analyze.isPending}
              className="px-3 py-1.5 rounded-md text-xs font-medium text-[color:var(--gold-foreground)] disabled:opacity-60 inline-flex items-center gap-1.5"
              style={{ background: "var(--gradient-gold)" }}>
              {analyze.isPending ? <><Loader2 className="h-3 w-3 animate-spin" /> Analysing…</> : "Run analysis"}
            </button>
          </div>

          {!setup && !analyze.isPending && (
            <div className="flex-1 flex flex-col items-center justify-center text-center text-sm text-muted-foreground py-10">
              <Layers className="h-8 w-8 mb-3 opacity-40" />
              Run analysis to get a structure-based setup on the {TIMEFRAMES.find((t) => t.v === timeframe)?.label} timeframe.
            </div>
          )}

          {setup && (
            <div className="flex-1 flex flex-col gap-4 overflow-hidden">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Bias</div>
                  <div className={`font-display text-xl font-semibold capitalize ${setup.bias === "bullish" ? "text-[color:var(--success)]" : setup.bias === "bearish" ? "text-[color:var(--destructive)]" : ""}`}>
                    {setup.bias ?? "—"}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Confidence</div>
                  <div className="font-display text-xl font-mono font-semibold gold-text">{Math.round(setup.confidence ?? 0)}%</div>
                </div>
              </div>

              {setup.setup ? (
                <>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className={`col-span-2 p-2 rounded-lg text-center font-medium ${setup.setup.direction === "BUY" ? "bg-[color:var(--success)]/15 text-[color:var(--success)]" : "bg-[color:var(--destructive)]/15 text-[color:var(--destructive)]"}`}>
                      {setup.setup.direction === "BUY" ? <TrendingUp className="h-3 w-3 inline mr-1" /> : <TrendingDown className="h-3 w-3 inline mr-1" />}
                      {setup.setup.direction} · R:R {fmtNum(setup.setup.risk_reward, 2)}
                    </div>
                    <Row label="Entry" v={fmtNum(setup.setup.entry, 2)} />
                    <Row label="Stop" v={fmtNum(setup.setup.stop_loss, 2)} tone="danger" />
                    <Row label="TP1" v={fmtNum(setup.setup.take_profit_1, 2)} tone="success" />
                    <Row label="TP2" v={fmtNum(setup.setup.take_profit_2, 2)} tone="success" />
                    <Row label="TP3" v={fmtNum(setup.setup.take_profit_3, 2)} tone="success" />
                    <Row label="Hold" v={`~${setup.setup.expected_hold_hours ?? "?"}h`} />
                  </div>

                  <p className="text-xs text-muted-foreground leading-relaxed overflow-auto max-h-40 pr-1">{setup.explanation}</p>

                  <button onClick={() => openTrade.mutate()} disabled={openTrade.isPending}
                    className="mt-auto py-2.5 rounded-lg font-medium text-sm inline-flex items-center justify-center gap-2 gold-border text-[color:var(--gold)] hover:bg-[color:var(--gold)]/10 disabled:opacity-60">
                    <Target className="h-4 w-4" />
                    {openTrade.isPending ? "Opening…" : "Open paper trade"}
                  </button>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">{setup.explanation ?? "No A+ setup right now — stand aside."}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Open trades */}
      <div className="glass-panel rounded-2xl p-5">
        <h2 className="font-display text-lg font-semibold mb-3">Open positions</h2>
        {openTrades.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">No open positions.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-widest text-muted-foreground text-left">
                <tr><th className="py-2">Dir</th><th>Entry</th><th>SL</th><th>TP1</th><th>Size</th><th>Conf</th><th>Session</th><th></th></tr>
              </thead>
              <tbody>
                {openTrades.map((t: any) => (
                  <tr key={t.id} className="border-t border-border/40 font-mono">
                    <td className={`py-2.5 font-semibold ${t.direction === "BUY" ? "text-[color:var(--success)]" : "text-[color:var(--destructive)]"}`}>{t.direction}</td>
                    <td>{fmtNum(t.entry_price, 2)}</td>
                    <td className="text-[color:var(--destructive)]">{fmtNum(t.stop_loss, 2)}</td>
                    <td className="text-[color:var(--success)]">{fmtNum(t.take_profit_1, 2)}</td>
                    <td>{fmtNum(t.lot_size, 2)}</td>
                    <td>{Math.round(t.confidence ?? 0)}%</td>
                    <td className="font-sans">{t.session ?? "—"}</td>
                    <td className="text-right">
                      <button onClick={() => closeTrade.mutate(t.id)} className="p-1.5 rounded-md hover:bg-accent text-muted-foreground" title="Close">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, v, tone }: { label: string; v: any; tone?: "success" | "danger" }) {
  return (
    <div className="flex items-center justify-between p-2 rounded-md bg-secondary/40">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`font-mono font-medium ${tone === "success" ? "text-[color:var(--success)]" : tone === "danger" ? "text-[color:var(--destructive)]" : ""}`}>{v}</span>
    </div>
  );
}
