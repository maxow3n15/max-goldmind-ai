import { cn } from "@/lib/utils";
import { Activity, BarChart3, Gauge, Layers, LineChart, Newspaper, Radar, ShieldCheck, Waves, Wrench } from "lucide-react";
import type { CompositeConfidence } from "@/lib/services/macro.types";
import type { ManagementRecommendation } from "@/lib/services/quant.types";

const ICONS: Record<string, typeof Activity> = {
  technical: BarChart3,
  news: Newspaper,
  sentiment: Waves,
  risk: ShieldCheck,
  volume: Layers,
  volatility: Gauge,
  momentum: LineChart,
  session: Activity,
  correlation: Radar,
};

function tone(score: number) {
  if (score >= 70) return "var(--success)";
  if (score >= 50) return "var(--gold)";
  if (score >= 40) return "var(--warning)";
  return "var(--destructive)";
}

/**
 * Full transparency panel: exactly how much every analysis module
 * contributed to the final probability score.
 */
export function ConfidenceBreakdownPanel({
  composite,
  management,
  threshold = 88,
}: {
  composite: CompositeConfidence | null;
  management?: ManagementRecommendation | null;
  threshold?: number;
}) {
  const rows = Array.isArray(composite?.contributions) ? composite.contributions : [];

  return (
    <div className="glass-panel rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Probability engine</div>
          <h2 className="font-display text-lg font-semibold">Confidence breakdown</h2>
        </div>
        <div className="text-right">
          <div className="font-display text-3xl font-bold gold-text tabular-nums">
            {composite ? `${composite.final}%` : "—"}
          </div>
          <div className="text-[10px] text-muted-foreground">overall probability · gate {threshold}%</div>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Waiting for the first full analysis cycle…</p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => {
            const Icon = ICONS[r.key] ?? Activity;
            return (
              <div key={r.key} className="space-y-1">
                <div className="flex items-center gap-2 text-xs">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">{r.label}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {Math.round(r.weight * 100)}%w
                  </span>
                  <span className="font-mono text-[11px] tabular-nums w-9 text-right" style={{ color: tone(r.score) }}>
                    {r.score}
                  </span>
                  <span className="font-mono text-[11px] tabular-nums w-11 text-right text-muted-foreground">
                    +{r.contribution}
                  </span>
                </div>
                <div className="h-1 rounded-full bg-secondary overflow-hidden">
                  <div className="h-full transition-all"
                    style={{ width: `${Math.max(2, Math.min(100, r.score))}%`, background: tone(r.score) }} />
                </div>
                {r.notes?.[0] && (
                  <p className="text-[10px] text-muted-foreground/80 truncate" title={r.notes.join(" · ")}>
                    {r.notes[0]}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {management && (
        <div className="rounded-xl bg-secondary/40 p-3 space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-medium">
            <Wrench className="h-3.5 w-3.5 text-[color:var(--gold)]" /> Trade management recommendation
          </div>
          <div className="grid grid-cols-2 gap-1 text-[11px] font-mono">
            <Kv k="Break-even" v={`${management.break_even_at_r}R`} />
            <Kv k="Partial" v={`${Math.round(management.partial_fraction * 100)}% @ ${management.partial_at_r}R`} />
            <Kv k="ATR trail" v={`${management.trail_atr_multiple.toFixed(1)}x`} />
            <Kv k="Stop distance" v={management.suggested_stop_distance != null ? `${management.suggested_stop_distance}` : "—"} />
          </div>
          <ul className="text-[10px] text-muted-foreground space-y-0.5">
            {management.notes.slice(0, 4).map((n, i) => <li key={i}>· {n}</li>)}
          </ul>
        </div>
      )}

      {composite && composite.blockers.length > 0 && (
        <div className="text-[11px] text-[color:var(--warning)]">
          <span className="font-medium">Not trading because:</span> {composite.blockers.slice(0, 3).join(" · ")}
        </div>
      )}
    </div>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className={cn("flex items-center justify-between px-1.5 py-1 rounded bg-background/40")}>
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}
