import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAutopilotContext } from "@/providers/AutopilotProvider";
import { fmtNum, fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Bot, ChevronDown, ChevronUp, Pause, Play, ShieldAlert, X, ExternalLink,
} from "lucide-react";

/**
 * Floating autopilot widget. The engine itself lives in AutopilotProvider,
 * so toggling it here keeps it running across every page.
 */
export function AutopilotWidget() {
  const a = useAutopilotContext();
  const [expanded, setExpanded] = useState(false);
  const [hidden, setHidden] = useState(false);

  const price = a.market.quote?.mid ?? null;
  const openTrades = Array.isArray(a.openTrades) ? a.openTrades : [];

  const rows = useMemo(() =>
    openTrades.map((t) => {
      const live = price ?? t.entry_price;
      const pnl = (t.direction === "BUY" ? live - t.entry_price : t.entry_price - live) * 100 * t.lot_size;
      return { ...t, live, pnl };
    }), [openTrades, price]);

  const totalPnl = rows.reduce((s, r) => s + r.pnl, 0);

  if (hidden) {
    return (
      <button
        onClick={() => setHidden(false)}
        className="fixed bottom-4 right-4 z-50 h-11 w-11 rounded-full grid place-items-center gold-border bg-background/90 backdrop-blur shadow-lg"
        title="Show autopilot"
      >
        <Bot className="h-5 w-5 text-[color:var(--gold)]" />
      </button>
    );
  }

  const state = a.killSwitch.active ? "halted" : a.running ? "live" : "paused";

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-border/60 bg-background/90 backdrop-blur-xl shadow-2xl overflow-hidden">
      {/* Header row */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("h-2 w-2 shrink-0 rounded-full",
            state === "live" ? "bg-[color:var(--success)] ticker-pulse"
              : state === "halted" ? "bg-[color:var(--destructive)]"
              : "bg-muted-foreground")} />
          <span className="truncate text-sm font-medium">Autopilot</span>
          <span className="truncate text-[10px] uppercase tracking-widest text-muted-foreground">
            {state === "live" ? "running" : state === "halted" ? "halted" : "paused"}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {a.killSwitch.active ? (
            <button onClick={a.resetKillSwitch} className="p-1.5 rounded-md hover:bg-accent text-[color:var(--destructive)]" title="Clear kill switch">
              <ShieldAlert className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={() => (a.running ? a.stop() : a.start())}
              className="p-1.5 rounded-md hover:bg-accent text-[color:var(--gold)]"
              title={a.running ? "Pause autopilot" : "Start autopilot"}
            >
              {a.running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
          )}
          <button onClick={() => setExpanded((v) => !v)} className="p-1.5 rounded-md hover:bg-accent text-muted-foreground" title="Expand">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
          <button onClick={() => setHidden(true)} className="p-1.5 rounded-md hover:bg-accent text-muted-foreground" title="Hide widget">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Compact strip */}
      <div className="grid grid-cols-3 gap-2 border-t border-border/40 px-3 py-2 text-center">
        <Metric label="Gold" value={price != null ? fmtNum(price, 2) : "—"} />
        <Metric label="Open" value={String(rows.length)} />
        <Metric
          label="Float P&L"
          value={fmtUsd(totalPnl)}
          tone={totalPnl >= 0 ? "success" : "danger"}
        />
      </div>

      {expanded && (
        <div className="max-h-80 overflow-auto border-t border-border/40 px-3 py-3 space-y-3">
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <Kv k="Confidence" v={`${Math.round(a.composite?.final ?? a.confluence?.score ?? 0)}%`} />
            <Kv k="Bias" v={a.analysis?.bias ?? "—"} />
            <Kv k="Feed" v={a.market.status} />
            <Kv k="Blocker" v={a.lastRejection ?? "none"} />
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Live positions</div>
            {rows.length === 0 ? (
              <div className="text-xs text-muted-foreground py-3 text-center">No open trades.</div>
            ) : (
              <ul className="space-y-1.5">
                {rows.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 rounded-lg bg-secondary/40 px-2 py-1.5 text-[11px] font-mono">
                    <span className={cn("shrink-0 font-semibold",
                      r.direction === "BUY" ? "text-[color:var(--success)]" : "text-[color:var(--destructive)]")}>
                      {r.direction}
                    </span>
                    <span className="truncate text-muted-foreground">
                      {fmtNum(r.entry_price, 2)} → {fmtNum(r.take_profit_1, 2)}
                    </span>
                    <span className="shrink-0">{fmtNum(r.lot_size, 2)}</span>
                    <span className={cn("shrink-0 font-semibold",
                      r.pnl >= 0 ? "text-[color:var(--success)]" : "text-[color:var(--destructive)]")}>
                      {fmtUsd(r.pnl)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Link to="/autopilot" className="inline-flex items-center gap-1.5 text-[11px] text-[color:var(--gold)] hover:underline">
            Open full control centre <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "success" | "danger" }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={cn("truncate font-mono text-xs font-semibold",
        tone === "success" ? "text-[color:var(--success)]" : tone === "danger" ? "text-[color:var(--destructive)]" : "")}>
        {value}
      </div>
    </div>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-secondary/40 px-2 py-1">
      <span className="text-muted-foreground">{k}</span>
      <span className="truncate font-mono capitalize">{v}</span>
    </div>
  );
}
