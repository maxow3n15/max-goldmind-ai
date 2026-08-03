import { createFileRoute } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import { Activity, Cpu, Database, Gauge, Radio, ShieldCheck, AlertTriangle } from "lucide-react";
import { diagnosticsEngine, type DiagnosticsSnapshot } from "@/engines/diagnostics.engine";
import { loggingEngine } from "@/engines/logging.engine";
import type { DecisionSnapshot } from "@/engines/kernel/event-bus";
import type { LatencyStat } from "@/engines/kernel/metrics";
import { cn } from "@/lib/utils";
import { HeartbeatPanel } from "@/components/HeartbeatPanel";

export const Route = createFileRoute("/_authenticated/diagnostics")({
  head: () => ({
    meta: [
      { title: "System Diagnostics — GoldMind AI" },
      { name: "description", content: "Live latency, engine health and AI decision audit trail for the GoldMind AI XAUUSD trading engine." },
      { property: "og:title", content: "System Diagnostics — GoldMind AI" },
      { property: "og:description", content: "Live latency, engine health and AI decision audit trail for the GoldMind AI XAUUSD trading engine." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DiagnosticsPage,
});

function useDiagnostics(): DiagnosticsSnapshot {
  return useSyncExternalStore(
    (cb) => diagnosticsEngine.subscribe(cb),
    () => diagnosticsEngine.getSnapshot(),
    () => diagnosticsEngine.getSnapshot(),
  );
}

function useDecisionLog(): DecisionSnapshot[] {
  return useSyncExternalStore(
    (cb) => loggingEngine.subscribe(cb),
    () => loggingEngine.getRecent(),
    () => loggingEngine.getRecent(),
  );
}

const LATENCY_LABELS: Record<string, string> = {
  market: "Market feed",
  ai: "AI analysis",
  quant: "Quant intel",
  macro: "Macro intel",
  confluence: "Confluence",
  strategy: "Strategy",
  risk: "Risk engine",
  broker: "Broker",
  execution: "Execution",
  endToEnd: "End to end",
};

function tone(ms: number | null) {
  if (ms == null) return "text-muted-foreground";
  if (ms < 250) return "text-emerald-400";
  if (ms < 1200) return "text-amber-400";
  return "text-red-400";
}

function LatencyRow({ stat }: { stat: LatencyStat }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border/40 last:border-0 text-sm">
      <span className="text-muted-foreground">{LATENCY_LABELS[stat.channel] ?? stat.channel}</span>
      <div className="flex items-center gap-4 font-mono text-xs">
        <span className={cn("w-16 text-right", tone(stat.last))}>{stat.last != null ? `${stat.last}ms` : "—"}</span>
        <span className="w-16 text-right text-muted-foreground">{stat.avg != null ? `${stat.avg}ms` : "—"}</span>
        <span className="w-16 text-right text-muted-foreground">{stat.p95 != null ? `${stat.p95}ms` : "—"}</span>
        <span className="w-10 text-right text-muted-foreground/70">{stat.count}</span>
      </div>
    </div>
  );
}

function DiagnosticsPage() {
  const diag = useDiagnostics();
  const decisions = useDecisionLog();

  const accepted = decisions.filter((d) => d.outcome === "accepted").length;
  const rejected = decisions.filter((d) => d.outcome === "rejected").length;

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-6xl">
        <header>
          <h1 className="font-display text-2xl md:text-3xl font-semibold">System <span className="gold-text">Diagnostics</span></h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live engine health, pipeline latency and the full AI decision audit trail.
          </p>
        </header>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricTile icon={Gauge} label="UI frame rate" value={diag.fps != null ? `${diag.fps} fps` : "—"} />
          <MetricTile icon={Cpu} label="JS heap" value={diag.metrics.heapUsedMb != null ? `${diag.metrics.heapUsedMb} MB` : "n/a"} />
          <MetricTile icon={Radio} label="Network" value={diag.online ? "Online" : "Offline"} />
          <MetricTile icon={Activity} label="Uptime" value={`${Math.round(diag.uptimeMs / 1000)}s`} />
        </div>

        <HeartbeatPanel />

        <section className="glass-panel p-5">
          <h2 className="font-display font-semibold mb-1 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[color:var(--gold)]" /> Engine health
          </h2>
          <p className="text-xs text-muted-foreground mb-3">Each engine runs independently of the React tree.</p>
          <div className="space-y-2">
            {diag.engines.map((e) => (
              <div key={e.id} className="flex items-center justify-between text-sm py-2 border-b border-border/40 last:border-0">
                <div className="flex items-center gap-2">
                  <span className={cn("h-2 w-2 rounded-full", e.running && e.healthy ? "bg-emerald-400" : e.running ? "bg-amber-400" : "bg-muted-foreground/40")} />
                  <span>{e.label}</span>
                </div>
                <span className="text-xs text-muted-foreground truncate max-w-[55%] text-right">
                  {e.running ? (e.detail ?? "running") : "stopped"}
                </span>
              </div>
            ))}
            {diag.engines.length === 0 && <p className="text-sm text-muted-foreground">No engines registered.</p>}
          </div>
        </section>

        <section className="glass-panel p-5">
          <h2 className="font-display font-semibold mb-1 flex items-center gap-2">
            <Activity className="h-4 w-4 text-[color:var(--gold)]" /> Pipeline latency
          </h2>
          <div className="flex items-center justify-end gap-4 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-mono pb-1">
            <span className="w-16 text-right">last</span>
            <span className="w-16 text-right">avg</span>
            <span className="w-16 text-right">p95</span>
            <span className="w-10 text-right">n</span>
          </div>
          {Object.values(diag.metrics.latency).map((stat) => (
            <LatencyRow key={stat.channel} stat={stat} />
          ))}
        </section>

        <section className="glass-panel p-5">
          <h2 className="font-display font-semibold mb-1 flex items-center gap-2">
            <Database className="h-4 w-4 text-[color:var(--gold)]" /> Decision audit trail
          </h2>
          <p className="text-xs text-muted-foreground mb-3">
            {accepted} accepted · {rejected} rejected in this session. Every evaluation is persisted.
          </p>
          <div className="space-y-2 max-h-[520px] overflow-y-auto">
            {decisions.map((d) => (
              <details key={d.cycleId} className="rounded-lg border border-border/50 p-3">
                <summary className="cursor-pointer text-sm flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className={cn("h-2 w-2 rounded-full shrink-0", d.outcome === "accepted" ? "bg-emerald-400" : d.outcome === "error" ? "bg-red-400" : "bg-amber-400")} />
                    <span className="font-mono text-xs shrink-0">{new Date(d.ts).toLocaleTimeString()}</span>
                    <span className="truncate">{d.direction ?? "no setup"} · {d.confidence ?? 0}%</span>
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">{d.outcome}</span>
                </summary>
                <div className="mt-3 space-y-3 text-xs">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-muted-foreground">
                    <span>Tech {d.technicalScore ?? "—"}%</span>
                    <span>News {d.newsScore ?? "—"}%</span>
                    <span>Px {d.price?.toFixed(2) ?? "—"}</span>
                    <span>Spread {d.spread?.toFixed(2) ?? "—"}</span>
                  </div>
                  {d.reasoning.length > 0 && (
                    <div>
                      <div className="text-muted-foreground mb-1">Reasoning</div>
                      <ul className="space-y-0.5 list-disc list-inside">
                        {d.reasoning.map((r, i) => <li key={i}>{r}</li>)}
                      </ul>
                    </div>
                  )}
                  {d.blockers.length > 0 && (
                    <div>
                      <div className="text-amber-400 mb-1 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> Blockers
                      </div>
                      <ul className="space-y-0.5 list-disc list-inside text-muted-foreground">
                        {d.blockers.map((b, i) => <li key={i}>{b}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              </details>
            ))}
            {decisions.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No decisions yet — start Autopilot and the engine will log every evaluation here.
              </p>
            )}
          </div>
        </section>
    </div>
  );
}

function MetricTile({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string }) {
  return (
    <div className="glass-panel p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="font-display text-xl mt-1">{value}</div>
    </div>
  );
}
