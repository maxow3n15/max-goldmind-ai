import { AlertTriangle, ArrowDownRight, ArrowUpRight, CalendarClock, Gauge, Minus, Newspaper, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CompositeConfidence, MacroReport } from "@/lib/services/macro.types";

const toneFor = (v: string) => {
  if (["bullish", "weak", "dovish", "risk-off", "falling"].includes(v)) return "text-emerald-400";
  if (["bearish", "strong", "hawkish", "risk-on", "rising"].includes(v)) return "text-rose-400";
  return "text-muted-foreground";
};

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass-panel rounded-xl p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("text-sm font-semibold capitalize mt-1", toneFor(value))}>{value}</p>
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">{Math.round(value)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted/40 mt-1 overflow-hidden">
        <div
          className={cn("h-full rounded-full", value >= 80 ? "bg-emerald-400" : value >= 60 ? "bg-amber-400" : "bg-rose-400")}
          style={{ width: `${Math.max(2, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}

export function MacroSentimentPanel({
  macro, composite, loading, onRefresh,
}: {
  macro: MacroReport | null;
  composite?: CompositeConfidence | null;
  loading?: boolean;
  onRefresh?: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="glass-panel rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Newspaper className="h-4 w-4 text-primary" />
            <h2 className="font-display text-lg font-semibold">Macro &amp; news intelligence</h2>
          </div>
          <div className="flex items-center gap-3">
            {macro && (
              <span className="text-xs text-muted-foreground">
                Updated {new Date(macro.generated_at).toLocaleTimeString()}
              </span>
            )}
            {onRefresh && (
              <button onClick={onRefresh} className="text-xs inline-flex items-center gap-1 text-primary hover:underline">
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
              </button>
            )}
          </div>
        </div>

        {!macro ? (
          <p className="text-sm text-muted-foreground mt-4">
            {loading ? "Reading global financial newswires…" : "No macro report loaded yet."}
          </p>
        ) : (
          <>
            {macro.degraded && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>Macro feed degraded — fundamental confidence held at neutral and autonomous execution is blocked.</span>
              </div>
            )}

            <div className="mt-4 flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Gauge className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-2xl font-semibold tabular-nums">{macro.news_score}<span className="text-sm text-muted-foreground">/100</span></p>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">News impact score</p>
                </div>
              </div>
              <div className={cn("inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium capitalize",
                macro.gold_bias === "bullish" ? "bg-emerald-500/15 text-emerald-400"
                  : macro.gold_bias === "bearish" ? "bg-rose-500/15 text-rose-400"
                  : "bg-muted/40 text-muted-foreground")}>
                {macro.gold_bias === "bullish" ? <ArrowUpRight className="h-3.5 w-3.5" />
                  : macro.gold_bias === "bearish" ? <ArrowDownRight className="h-3.5 w-3.5" />
                  : <Minus className="h-3.5 w-3.5" />}
                {macro.gold_bias} for gold
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
              <Tile label="Dollar strength" value={macro.dollar_strength} />
              <Tile label="Rate outlook" value={macro.rate_outlook} />
              <Tile label="Risk environment" value={macro.risk_environment} />
              <Tile label="Treasury yields" value={macro.yields} />
            </div>

            <p className="text-sm text-muted-foreground leading-relaxed mt-4">{macro.summary}</p>

            <div className="grid md:grid-cols-2 gap-4 mt-4">
              <div>
                <p className="text-xs font-medium text-emerald-400 mb-1">Bullish drivers</p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {macro.bullish_drivers.length ? macro.bullish_drivers.map((d, i) => <li key={i}>✓ {d}</li>) : <li>None detected</li>}
                </ul>
              </div>
              <div>
                <p className="text-xs font-medium text-rose-400 mb-1">Bearish drivers</p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {macro.bearish_drivers.length ? macro.bearish_drivers.map((d, i) => <li key={i}>✗ {d}</li>) : <li>None detected</li>}
                </ul>
              </div>
            </div>
          </>
        )}
      </div>

      {composite && (
        <div className="glass-panel rounded-2xl p-5">
          <h3 className="font-display text-base font-semibold">Confidence breakdown</h3>
          <div className="grid md:grid-cols-2 gap-x-6 gap-y-3 mt-3">
            <ScoreBar label="Technical analysis" value={composite.technical} />
            <ScoreBar label="News / fundamental" value={composite.news} />
            <ScoreBar label="Market sentiment" value={composite.sentiment} />
            <ScoreBar label="Risk conditions" value={composite.risk} />
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums gold-text">{composite.final}%</span>
            <span className="text-xs text-muted-foreground">final AI trade confidence</span>
          </div>
          <ul className="mt-3 space-y-1 text-xs">
            {composite.gates.map((g) => (
              <li key={g.key} className={cn("flex gap-2", g.passed ? "text-muted-foreground" : "text-rose-400")}>
                <span>{g.passed ? "✓" : "✗"}</span>
                <span>{g.label}{g.detail ? ` — ${g.detail}` : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <div className="glass-panel rounded-2xl p-5">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-primary" />
            <h3 className="font-display text-base font-semibold">Upcoming economic events</h3>
          </div>
          {macro?.blackout.active && (
            <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-300">
              Event blackout: {macro.blackout.reason} — new entries blocked.
            </p>
          )}
          <ul className="mt-3 space-y-2">
            {(macro?.upcoming_events ?? []).length === 0 && (
              <li className="text-xs text-muted-foreground">No high-impact events flagged.</li>
            )}
            {(macro?.upcoming_events ?? []).map((e, i) => (
              <li key={i} className="flex items-start justify-between gap-3 text-xs">
                <div>
                  <p className="font-medium">{e.name}</p>
                  <p className="text-muted-foreground">
                    {e.when}{e.hours_away != null ? ` · ~${e.hours_away}h away` : ""}
                    {e.expectation ? ` · ${e.expectation}` : ""}
                    {e.priced_in ? " · largely priced in" : ""}
                  </p>
                </div>
                <span className={cn("rounded-full px-2 py-0.5 shrink-0 capitalize",
                  e.impact === "high" ? "bg-rose-500/15 text-rose-400"
                    : e.impact === "medium" ? "bg-amber-500/15 text-amber-400"
                    : "bg-muted/40 text-muted-foreground")}>{e.impact}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="glass-panel rounded-2xl p-5">
          <h3 className="font-display text-base font-semibold">Breaking headlines</h3>
          <ul className="mt-3 space-y-3">
            {(macro?.headlines ?? []).length === 0 && (
              <li className="text-xs text-muted-foreground">No scored headlines yet.</li>
            )}
            {(macro?.headlines ?? []).map((h, i) => (
              <li key={i} className="text-xs">
                <div className="flex items-start gap-2">
                  <span className={cn("mt-0.5 shrink-0",
                    h.gold_effect === "bullish" ? "text-emerald-400" : h.gold_effect === "bearish" ? "text-rose-400" : "text-muted-foreground")}>
                    {h.gold_effect === "bullish" ? "▲" : h.gold_effect === "bearish" ? "▼" : "•"}
                  </span>
                  <div>
                    {h.url ? (
                      <a href={h.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">{h.title}</a>
                    ) : <p className="font-medium">{h.title}</p>}
                    <p className="text-muted-foreground">{h.source} · {h.impact} impact — {h.reason}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
