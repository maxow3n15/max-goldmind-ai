import { Wifi, WifiOff, Loader2, AlertTriangle } from "lucide-react";
import type { ConnectionStatus, MarketQuote } from "@/lib/market-data.types";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  quote: MarketQuote | null;
  status: ConnectionStatus;
  lastUpdated: number | null;
  lastError: string | null;
}

function relative(ts: number | null): string {
  if (!ts) return "—";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 2) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

const STATUS_META: Record<ConnectionStatus, { dot: string; label: string; Icon: any }> = {
  connected: { dot: "bg-[color:var(--success)]", label: "🟢 Connected", Icon: Wifi },
  reconnecting: { dot: "bg-[color:var(--warning)]", label: "🟡 Reconnecting", Icon: Loader2 },
  disconnected: { dot: "bg-[color:var(--destructive)]", label: "🔴 Disconnected", Icon: WifiOff },
};

export function MarketStatusCard({ quote, status, lastUpdated, lastError }: Props) {
  const meta = STATUS_META[status];
  const Icon = meta.Icon;
  return (
    <div className="glass-panel rounded-2xl p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-medium">Market Status</div>
          <div className="font-display text-lg font-semibold">XAUUSD · Live</div>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <span className={cn("h-2 w-2 rounded-full ticker-pulse", meta.dot)} />
          <Icon className={cn("h-3.5 w-3.5", status === "reconnecting" && "animate-spin")} />
          <span className="text-muted-foreground">{meta.label}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Metric label="Bid" value={fmtNum(quote?.bid, 2)} tone="danger" />
        <Metric label="Ask" value={fmtNum(quote?.ask, 2)} tone="success" />
        <Metric label="Spread" value={quote ? fmtNum(quote.spread, 2) : "—"} />
      </div>

      <div className="flex items-center justify-between text-[11px] text-muted-foreground border-t border-border/40 pt-3">
        <span>Last update · <span className="font-mono">{relative(lastUpdated)}</span></span>
        <span className="truncate ml-3">Source · {quote?.source ?? "—"}</span>
      </div>

      {status !== "connected" && lastUpdated && (
        <div className="flex items-start gap-2 text-[11px] text-[color:var(--warning)] bg-[color:var(--warning)]/10 rounded-md p-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>Live prices unavailable — showing last known quote. Historical chart continues to load.</span>
        </div>
      )}
      {status === "disconnected" && !lastUpdated && (
        <div className="text-[11px] text-[color:var(--destructive)]">
          No market data received yet. {lastError && <span className="opacity-70">({lastError})</span>}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "success" | "danger" }) {
  return (
    <div className="p-2 rounded-md bg-secondary/40">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn(
        "font-mono font-semibold text-lg tabular-nums",
        tone === "success" && "text-[color:var(--success)]",
        tone === "danger" && "text-[color:var(--destructive)]",
      )}>{value}</div>
    </div>
  );
}
