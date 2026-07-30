import { useEffect, useState } from "react";
import { Activity, Brain, Landmark, Radio, Wifi, WifiOff } from "lucide-react";
import { useAI, useBroker, useMarketDataContext } from "@/providers/PlatformProviders";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";

type Tone = "ok" | "warn" | "bad";

const TONE: Record<Tone, string> = {
  ok: "bg-[color:var(--success)]",
  warn: "bg-[color:var(--warning)]",
  bad: "bg-[color:var(--destructive)]",
};

function Pill({ tone, label, value, title, Icon }: {
  tone: Tone; label: string; value: string; title?: string; Icon: any;
}) {
  return (
    <div title={title} className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-background/40 border border-border/50 whitespace-nowrap">
      <span className={cn("h-1.5 w-1.5 rounded-full", TONE[tone], tone !== "bad" && "animate-pulse")} />
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-[11px] font-medium">{value}</span>
    </div>
  );
}

function useTicker() {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
}

export function GlobalStatusBar() {
  const market = useMarketDataContext();
  const ai = useAI();
  const broker = useBroker();
  useTicker();

  const marketTone: Tone = market.status === "connected" ? "ok" : market.status === "reconnecting" ? "warn" : "bad";
  const aiTone: Tone = ai.error ? "bad" : ai.analysing ? "warn" : ai.analysis ? "ok" : "warn";
  const brokerTone: Tone = broker.connection === "connected" ? "ok" : broker.connection === "mock" ? "warn" : "bad";

  const ago = market.lastUpdated ? Math.max(0, Math.floor((Date.now() - market.lastUpdated) / 1000)) : null;

  return (
    <div className="sticky top-0 z-30 w-full border-b border-border/60 glass-panel rounded-none">
      <div className="flex items-center gap-2 overflow-x-auto px-3 py-2 no-scrollbar">
        <Pill
          Icon={market.status === "connected" ? Wifi : WifiOff}
          tone={marketTone}
          label="Market"
          value={market.status === "connected" ? `Live · ${market.marketStatus}` : market.status}
          title={market.error ?? undefined}
        />
        <Pill Icon={Brain} tone={aiTone} label="AI"
          value={ai.error ? "Error" : ai.analysing ? "Analysing" : ai.analysis ? `${ai.analysis.bias ?? "—"}` : "Idle"}
          title={ai.error ?? undefined} />
        <Pill Icon={Landmark} tone={brokerTone} label="Broker"
          value={broker.connection === "mock" ? "Simulated" : broker.connection}
          title={broker.name} />
        <Pill Icon={Radio} tone="ok" label="Mode" value={broker.tradingMode === "paper" ? "Paper" : "Live"} />

        <div className="ml-auto flex items-center gap-3 pl-3 whitespace-nowrap">
          <div className="font-mono text-sm">
            <span className="text-muted-foreground text-[10px] uppercase tracking-wider mr-1.5">XAUUSD</span>
            <span className="gold-text font-semibold">{market.quote ? fmtNum(market.quote.mid, 2) : "—"}</span>
          </div>
          <div className="text-[11px] text-muted-foreground font-mono">
            spread {market.quote ? fmtNum(market.quote.spread, 2) : "—"}
          </div>
          <div className="text-[11px] text-muted-foreground font-mono flex items-center gap-1">
            <Activity className="h-3 w-3" />
            {market.latencyMs != null ? `${market.latencyMs}ms` : "—"}
          </div>
          <div className="text-[11px] text-muted-foreground font-mono">
            {ago == null ? "no data" : ago < 2 ? "just now" : `${ago}s ago`}
          </div>
        </div>
      </div>

      {market.status !== "connected" && market.error ? (
        <div className="px-3 pb-2 text-[11px] text-[color:var(--warning)]">
          Feed degraded — {market.error}
        </div>
      ) : null}
    </div>
  );
}
