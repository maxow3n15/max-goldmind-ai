import { Brain, Clock, Layers, Target, TrendingDown, TrendingUp, Minus, RefreshCw } from "lucide-react";
import { useAI, AI_CONFIDENCE_THRESHOLD } from "@/providers/PlatformProviders";
import { currentSession } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

function Row({ label, value, Icon }: { label: string; value: string; Icon?: any }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-border/40 last:border-0">
      <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground shrink-0">
        {Icon ? <Icon className="h-3 w-3" /> : null}
        {label}
      </span>
      <span className="text-xs text-right">{value}</span>
    </div>
  );
}

export function AIStatusPanel() {
  const ai = useAI();
  const a = ai.analysis;
  const score = Math.round(ai.confluence?.score ?? a?.confidence ?? 0);

  const BiasIcon = a?.bias === "bullish" ? TrendingUp : a?.bias === "bearish" ? TrendingDown : Minus;
  const biasTone =
    a?.bias === "bullish" ? "text-[color:var(--success)]"
    : a?.bias === "bearish" ? "text-[color:var(--destructive)]"
    : "text-muted-foreground";

  return (
    <div className="glass-panel rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-[color:var(--gold)]" />
          <h3 className="text-sm font-semibold">AI Engine</h3>
        </div>
        <button
          onClick={() => void ai.refresh()}
          disabled={ai.analysing}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3 w-3", ai.analysing && "animate-spin")} />
          {ai.analysing ? "Analysing" : "Refresh"}
        </button>
      </div>

      {!a && ai.analysing ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
        </div>
      ) : !a ? (
        <p className="text-xs text-muted-foreground">Waiting for the first analysis — it runs automatically as soon as live prices arrive.</p>
      ) : (
        <>
          <div className="flex items-center gap-4 mb-3">
            <div className={cn("flex items-center gap-1.5 font-display text-lg font-semibold capitalize", biasTone)}>
              <BiasIcon className="h-5 w-5" /> {a.bias ?? "neutral"}
            </div>
            <div className="flex-1">
              <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                <span>Confidence</span><span className="font-mono">{score}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", score >= AI_CONFIDENCE_THRESHOLD ? "bg-[color:var(--success)]" : "bg-[color:var(--warning)]")}
                  style={{ width: `${Math.min(100, score)}%` }}
                />
              </div>
            </div>
          </div>

          <Row label="Session" value={a.session_context ?? currentSession()} Icon={Clock} />
          <Row label="Trend" value={a.bias === "bullish" ? "Uptrend" : a.bias === "bearish" ? "Downtrend" : "Ranging"} />
          <Row label="Structure" value={a.market_structure ?? "—"} Icon={Layers} />
          <Row label="Liquidity" value={a.liquidity ?? "—"} />
          <Row label="Strategy" value={a.strategy ?? "—"} Icon={Target} />
          <Row label="Last analysis" value={new Date(a.generatedAt).toLocaleTimeString()} />

          {ai.belowThreshold ? (
            <div className="mt-3 rounded-lg border border-[color:var(--warning)]/40 bg-[color:var(--warning)]/10 p-2.5 text-[11px] text-[color:var(--warning)]">
              No execution: confidence {score}% is under the {AI_CONFIDENCE_THRESHOLD}% threshold. {ai.thresholdReason}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
