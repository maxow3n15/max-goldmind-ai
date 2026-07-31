import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useAutopilot } from "@/hooks/useAutopilot";
import { MarketStatusCard } from "@/components/MarketStatusCard";
import { MacroSentimentPanel } from "@/components/MacroSentimentPanel";
import { ConfidenceBreakdownPanel } from "@/components/ConfidenceBreakdownPanel";
import { fmtNum, fmtPct, fmtUsd } from "@/lib/format";
import {
  Activity, AlertTriangle, Ban, Bot, CheckCircle2, ChevronRight, Info,
  Loader2, Pause, Play, ShieldAlert, ShieldCheck, TrendingDown, TrendingUp, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/autopilot")({
  component: Autopilot,
  head: () => ({
    meta: [
      { title: "Autopilot · GoldMind AI" },
      { name: "description", content: "Autonomous XAUUSD trading — analysis, safety checks, execution and position management in one control panel." },
      { property: "og:title", content: "Autopilot · GoldMind AI" },
      { property: "og:description", content: "Run paper-mode autonomous XAUUSD analysis, safety checks and trade management." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

const TIMEFRAMES = [
  { v: "5", label: "5m" }, { v: "15", label: "15m" }, { v: "30", label: "30m" },
  { v: "60", label: "1H" }, { v: "240", label: "4H" },
] as const;

function Autopilot() {
  const [timeframe, setTimeframe] = useState<string>("15");
  const a = useAutopilot({ timeframe });

  const setup = a.analysis?.setup ?? null;
  const conf = a.confluence?.score ?? a.analysis?.confidence ?? 0;
  const confluenceBreakdown = Array.isArray(a.confluence?.breakdown) ? a.confluence.breakdown : [];
  const safetyChecks = Array.isArray(a.safety?.checks) ? a.safety.checks : [];
  const eventRows = Array.isArray(a.events) ? a.events : [];
  const openTrades = Array.isArray(a.openTrades) ? a.openTrades : [];
  const passingSafetyChecks = safetyChecks.filter((c) => c.passed).length;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Header + master switch */}
      <header className="flex items-start md:items-center justify-between flex-col md:flex-row gap-3">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-semibold flex items-center gap-2">
            <Bot className="h-6 w-6 text-[color:var(--gold)]" /> Autopilot
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Fully autonomous XAUUSD trader. Analyses, decides, executes, and manages positions.
            Currently running in <span className="text-[color:var(--gold)] font-medium">paper mode</span> — MT5 execution is a placeholder until the external bridge is deployed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {a.killSwitch.active ? (
            <button onClick={a.resetKillSwitch}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-[color:var(--destructive)]/15 text-[color:var(--destructive)] gold-border border-[color:var(--destructive)]/40 inline-flex items-center gap-2">
              <ShieldAlert className="h-4 w-4" /> Reset kill switch
            </button>
          ) : a.running ? (
            <button onClick={a.stop}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-secondary inline-flex items-center gap-2">
              <Pause className="h-4 w-4" /> Pause autopilot
            </button>
          ) : (
            <button onClick={a.start}
              className="px-5 py-2 rounded-lg text-sm font-semibold text-[color:var(--gold-foreground)] inline-flex items-center gap-2"
              style={{ background: "var(--gradient-gold)", boxShadow: "var(--shadow-gold)" }}>
              <Play className="h-4 w-4" /> Start autopilot
            </button>
          )}
          <button onClick={() => a.triggerKillSwitch("Manual emergency stop")}
            title="Emergency stop"
            className="p-2 rounded-lg bg-secondary text-[color:var(--destructive)] hover:bg-[color:var(--destructive)]/10">
            <Ban className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Live status banner */}
      <div className={cn("rounded-2xl p-4 flex items-start gap-3 text-sm border",
        a.killSwitch.active ? "bg-[color:var(--destructive)]/10 border-[color:var(--destructive)]/30 text-[color:var(--destructive)]"
          : a.running ? "bg-[color:var(--success)]/10 border-[color:var(--success)]/30 text-[color:var(--success)]"
          : "bg-secondary/40 border-border/40")}>
        {a.killSwitch.active ? <ShieldAlert className="h-5 w-5 mt-0.5" />
          : a.running ? <Activity className="h-5 w-5 mt-0.5 animate-pulse" />
          : <Info className="h-5 w-5 mt-0.5 text-muted-foreground" />}
        <div className="flex-1">
          <div className="font-medium">
            {a.killSwitch.active
              ? `Kill switch active — ${a.killSwitch.reason}`
              : a.running
                ? "Autopilot is running. Standing by for A+ setups."
                : "Autopilot is paused."}
          </div>
          <div className="text-xs opacity-80 mt-0.5">
            The engine runs while this page is open. For 24/7 headless operation, deploy the external trading worker.
          </div>
        </div>
      </div>

      {/* Macro & news intelligence */}
      <MacroSentimentPanel
        macro={a.macro}
        composite={a.composite}
        loading={a.macroLoading}
        onRefresh={a.refreshMacro}
      />

      {/* Top row */}
      <div className="grid lg:grid-cols-3 gap-4">
        <MarketStatusCard quote={a.market.quote} status={a.market.status}
          lastUpdated={a.market.lastUpdated} lastError={a.market.lastError} />

        {/* Confidence panel */}
        <div className="glass-panel rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Confidence engine</div>
              <div className="font-display text-lg font-semibold">Weighted confluence</div>
            </div>
            {a.analysing && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          <div className="flex items-baseline gap-3">
            <div className="font-display text-4xl font-bold gold-text tabular-nums">{Math.round(conf)}%</div>
            <div className="text-xs text-muted-foreground">
              min required: <span className="text-foreground font-mono">{a.constants.MIN_CONFIDENCE}%</span>
            </div>
          </div>
          <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
            <div className="h-full transition-all"
              style={{ width: `${Math.min(100, conf)}%`, background: conf >= a.constants.MIN_CONFIDENCE ? "var(--gradient-gold)" : "var(--warning)" }} />
          </div>
          <div className="grid grid-cols-2 gap-1 text-[11px] max-h-40 overflow-auto pr-1">
            {confluenceBreakdown.length > 0 ? confluenceBreakdown.map((b) => (
              <div key={b.key} className="flex items-center gap-1.5 truncate">
                {b.passed
                  ? <CheckCircle2 className="h-3 w-3 shrink-0 text-[color:var(--success)]" />
                  : <XCircle className="h-3 w-3 shrink-0 text-muted-foreground/60" />}
                <span className={cn("truncate", !b.passed && "text-muted-foreground/70")}>{b.label}</span>
              </div>
            )) : <span className="text-muted-foreground text-xs col-span-2">Waiting for analysis…</span>}
          </div>
        </div>

        {/* Setup panel */}
        <div className="glass-panel rounded-2xl p-5 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Current setup</div>
              <div className="font-display text-lg font-semibold">AI trade plan</div>
            </div>
            <div className="flex gap-1 p-1 bg-secondary rounded-lg">
              {TIMEFRAMES.map((t) => (
                <button key={t.v} onClick={() => setTimeframe(t.v)}
                  className={cn("px-2 py-0.5 text-[10px] rounded font-mono",
                    timeframe === t.v ? "bg-[color:var(--gold)] text-[color:var(--gold-foreground)]" : "text-muted-foreground")}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          {setup ? (
            <div className="space-y-2 text-xs">
              <div className={cn("p-2 rounded-lg text-center font-medium",
                setup.direction === "BUY" ? "bg-[color:var(--success)]/15 text-[color:var(--success)]"
                  : "bg-[color:var(--destructive)]/15 text-[color:var(--destructive)]")}>
                {setup.direction === "BUY" ? <TrendingUp className="h-3 w-3 inline mr-1" /> : <TrendingDown className="h-3 w-3 inline mr-1" />}
                {setup.direction} · R:R {fmtNum(setup.risk_reward, 2)}
              </div>
              <div className="grid grid-cols-2 gap-1 font-mono">
                <Kv k="Entry" v={fmtNum(setup.entry, 2)} />
                <Kv k="Stop" v={fmtNum(setup.stop_loss, 2)} tone="danger" />
                <Kv k="TP1" v={fmtNum(setup.take_profit_1, 2)} tone="success" />
                <Kv k="TP2" v={fmtNum(setup.take_profit_2, 2)} tone="success" />
              </div>
              {a.lastRejection && (
                <div className="text-[11px] text-[color:var(--warning)] bg-[color:var(--warning)]/10 rounded p-2 flex gap-1.5">
                  <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                  <span><span className="font-medium">Blocked:</span> {a.lastRejection}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 text-xs text-muted-foreground flex items-center justify-center text-center py-8">
              {a.analysing ? "Analysing…" : "No setup yet. Start autopilot to begin scanning."}
            </div>
          )}
        </div>
      </div>

      {/* Probability breakdown + quantitative modules */}
      <div className="grid lg:grid-cols-2 gap-4">
        <ConfidenceBreakdownPanel composite={a.composite} management={a.management} threshold={a.constants.MIN_CONFIDENCE} />

        <div className="glass-panel rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">Quantitative modules</h2>
            {a.quantLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <Module title="Volume & participation" score={a.quant?.volume.score}
              lines={[
                `Relative volume ${a.quant?.volume.relative_volume ?? "—"}x · ${a.quant?.volume.participation ?? "—"}`,
                a.quant?.volume.exhaustion ? "Exhaustion detected" : a.quant?.volume.spike ? "Volume spike" : "No spike",
                a.quant?.volume.pullback_volume_declining ? "Pullback volume declining" : "Pullback volume elevated",
              ]} />
            <Module title="Volatility" score={a.quant?.volatility.score}
              lines={[
                `ATR ${a.quant?.volatility.atr ?? "—"} (${a.quant?.volatility.atr_pct ?? "—"}% of price)`,
                `Regime: ${a.quant?.volatility.regime ?? "—"} · pct ${a.quant?.volatility.percentile ?? "—"}`,
                `ADR ${a.quant?.volatility.adr ?? "—"} · used ${a.quant?.volatility.adr_used_pct ?? "—"}%`,
                a.quant?.volatility.extended_move ? "Extended move — waiting for pullback" : "Not over-extended",
              ]} />
            <Module title="Momentum" score={a.quant?.momentum.score}
              lines={[
                `RSI ${a.quant?.momentum.rsi ?? "—"} · StochRSI ${a.quant?.momentum.stoch_rsi ?? "—"}`,
                `MACD ${a.quant?.momentum.macd_histogram ?? "—"} · ADX ${a.quant?.momentum.adx ?? "—"}`,
                `CCI ${a.quant?.momentum.cci ?? "—"} · ROC ${a.quant?.momentum.roc ?? "—"}%`,
                `Trend strength ${a.quant?.momentum.trend_strength ?? 0}/100`,
              ]} />
            <Module title="Candle quality" score={a.quant?.candles.score}
              lines={[
                `Quality: ${a.quant?.candles.quality ?? "—"}`,
                `Body ${a.quant?.candles.body_pct ?? "—"}% · wicks ${a.quant?.candles.upper_wick_pct ?? "—"}/${a.quant?.candles.lower_wick_pct ?? "—"}%`,
                a.quant?.candles.patterns.length ? a.quant.candles.patterns.join(", ") : "No decisive pattern",
              ]} />
            <Module title="Correlation" score={a.quant?.correlation.score}
              lines={[
                `${a.quant?.correlation.supporting ?? 0} supporting · ${a.quant?.correlation.conflicting ?? 0} conflicting`,
                ...(a.quant?.correlation.legs ?? []).slice(0, 4).map(
                  (l) => `${l.label}: ${l.change_pct == null ? "—" : `${l.change_pct > 0 ? "+" : ""}${l.change_pct}%`}`),
              ]} />
            <Module title="Trading session" score={a.sessionReport?.score}
              lines={[
                `${a.sessionReport?.current ?? "—"}${a.sessionReport?.favoured ? " · favoured" : ""}`,
                a.sessionReport?.current_stat
                  ? `${a.sessionReport.current_stat.win_rate}% win · R:R ${a.sessionReport.current_stat.avg_rr} · ${a.sessionReport.current_stat.avg_duration_minutes}m avg hold`
                  : "No closed-trade history in this session yet",
              ]} />
          </div>
        </div>
      </div>

      {/* Safety + events */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="glass-panel rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            {a.safety?.ok ? <ShieldCheck className="h-4 w-4 text-[color:var(--success)]" />
              : <ShieldAlert className="h-4 w-4 text-[color:var(--warning)]" />}
            <h2 className="font-display text-lg font-semibold">Safety engine</h2>
            <span className="ml-auto text-xs text-muted-foreground">
              {passingSafetyChecks} / {safetyChecks.length} passing
            </span>
          </div>
          <div className="space-y-1.5 max-h-[420px] overflow-auto pr-1">
            {safetyChecks.length > 0 ? safetyChecks.map((c) => (
              <div key={c.key} className="flex items-center gap-2 text-xs py-1.5 border-b border-border/30 last:border-0">
                {c.passed ? <CheckCircle2 className="h-3.5 w-3.5 text-[color:var(--success)] shrink-0" />
                  : <XCircle className="h-3.5 w-3.5 text-[color:var(--destructive)] shrink-0" />}
                <span className={cn("flex-1", !c.passed && "text-muted-foreground")}>{c.label}</span>
                {c.detail && <span className="font-mono text-[10px] text-muted-foreground truncate max-w-[50%]" title={c.detail}>{c.detail}</span>}
              </div>
            )) : <span className="text-xs text-muted-foreground">Waiting for first cycle…</span>}
          </div>
        </div>

        {/* Event log */}
        <div className="glass-panel rounded-2xl p-5 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-lg font-semibold">Live event log</h2>
            <span className="text-xs text-muted-foreground">last {eventRows.length}</span>
          </div>
          <div className="space-y-1.5 max-h-[420px] overflow-auto pr-1 font-mono text-[11px]">
            {eventRows.length === 0 && <span className="text-muted-foreground">No events yet.</span>}
            {eventRows.map((e) => (
              <div key={e.id} className="flex items-start gap-2 py-1 border-b border-border/30 last:border-0">
                <span className="text-muted-foreground shrink-0">{new Date(e.ts).toISOString().slice(11, 19)}</span>
                <ChevronRight className={cn("h-3 w-3 mt-0.5 shrink-0",
                  e.level === "success" && "text-[color:var(--success)]",
                  e.level === "error" && "text-[color:var(--destructive)]",
                  e.level === "warn" && "text-[color:var(--warning)]",
                  e.level === "info" && "text-muted-foreground")} />
                <div className="flex-1">
                  <div>{e.message}</div>
                  {e.detail && <div className="text-muted-foreground opacity-70">{e.detail}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Metrics strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Metric label="Mode" value={a.executor.mode.toUpperCase()} hint={a.executor.connected ? "connected" : "offline"} />
        <Metric label="Open positions" value={String(openTrades.length)} />
        <Metric label="Trades today" value={String(a.todayTradeCount)} />
        <Metric label="Loss streak" value={String(a.consecutiveLosses)} tone={a.consecutiveLosses >= 2 ? "danger" : undefined} />
        <Metric label="Daily P&L" value={fmtUsd(a.snapshot?.daily_pnl ?? 0)}
          tone={(a.snapshot?.daily_pnl ?? 0) >= 0 ? "success" : "danger"}
          hint={`Balance ${fmtUsd(Number(a.snapshot?.account?.balance ?? 0))}`} />
      </div>

      {/* MT5 placeholder card */}
      <div className="rounded-2xl border border-dashed border-[color:var(--gold)]/30 p-5 flex items-start gap-3">
        <div className="h-9 w-9 rounded-lg gold-border flex items-center justify-center shrink-0">
          <Bot className="h-4 w-4 text-[color:var(--gold)]" />
        </div>
        <div className="text-sm">
          <div className="font-display font-semibold">MT5 execution bridge · not connected</div>
          <p className="text-muted-foreground text-xs mt-1 max-w-2xl">
            Live MT5 execution requires an external Python/Node bridge exposing the trading-server API.
            Set <code className="font-mono text-[color:var(--gold)]">VITE_TRADING_SERVER_URL</code> and deploy the
            connector to swap the paper engine for live execution — no UI changes required.
            Recommendation: log 300–500 autonomous paper trades and validate win rate, profit factor and drawdown before enabling live routing.
          </p>
        </div>
      </div>
    </div>
  );
}

function Kv({ k, v, tone }: { k: string; v: any; tone?: "success" | "danger" }) {
  return (
    <div className="flex items-center justify-between p-1.5 rounded bg-secondary/40">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</span>
      <span className={cn("font-mono font-medium",
        tone === "success" && "text-[color:var(--success)]",
        tone === "danger" && "text-[color:var(--destructive)]")}>{v}</span>
    </div>
  );
}

function Metric({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "success" | "danger" }) {
  return (
    <div className="glass-panel rounded-xl p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={cn("font-display text-lg font-semibold mt-0.5",
        tone === "success" && "text-[color:var(--success)]",
        tone === "danger" && "text-[color:var(--destructive)]")}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

// Silence unused import warning: fmtPct kept for future breakdowns.
void fmtPct;
