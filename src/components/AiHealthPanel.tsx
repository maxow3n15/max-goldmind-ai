import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Brain, AlertTriangle, Timer, Gauge } from "lucide-react";
import { getAiHealth, type AiHealthBucket } from "@/lib/ai-health.functions";
import { cn } from "@/lib/utils";

function successRate(b: AiHealthBucket) {
  return b.calls === 0 ? null : Math.round((b.ok / b.calls) * 100);
}

function rateTone(pct: number | null) {
  if (pct == null) return "text-muted-foreground";
  if (pct >= 90) return "text-emerald-400";
  if (pct >= 70) return "text-amber-400";
  return "text-red-400";
}

export function AiHealthPanel() {
  const fetchHealth = useServerFn(getAiHealth);
  const { data, isLoading } = useQuery({
    queryKey: ["ai-health"],
    queryFn: () => fetchHealth(),
    refetchInterval: 30_000,
  });

  const total = data?.total;
  const pct = total ? successRate(total) : null;

  return (
    <section className="glass-panel p-5">
      <h2 className="font-display font-semibold mb-1 flex items-center gap-2">
        <Brain className="h-4 w-4 text-[color:var(--gold)]" /> AI health
      </h2>
      <p className="text-xs text-muted-foreground mb-3">
        Your account&rsquo;s AI calls over the last {data?.windowHours ?? 24}h — timeouts, rate limits and rejected setups.
      </p>

      {isLoading && <p className="text-sm text-muted-foreground">Loading AI telemetry…</p>}

      {data && total && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Tile label="Success rate" value={pct != null ? `${pct}%` : "—"} tone={rateTone(pct)} icon={Gauge} />
            <Tile label="Calls" value={String(total.calls)} />
            <Tile label="Avg latency" value={total.avgLatencyMs != null ? `${total.avgLatencyMs}ms` : "—"} icon={Timer} />
            <Tile label="p95 latency" value={total.p95LatencyMs != null ? `${total.p95LatencyMs}ms` : "—"} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
            <Counter label="Timeouts" value={total.timeouts} />
            <Counter label="Rate limits (429)" value={total.rateLimits} />
            <Counter label="Upstream errors" value={total.upstreamErrors} />
            <Counter label="Validation rejects" value={total.validationRejects} />
            <Counter label="Retries burned" value={total.retries} />
          </div>

          <div className="mb-5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground/70 mb-2">Per source</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead className="text-muted-foreground/70">
                  <tr className="text-right">
                    <th className="text-left font-normal py-1">source</th>
                    <th className="font-normal">calls</th>
                    <th className="font-normal">ok</th>
                    <th className="font-normal">t/o</th>
                    <th className="font-normal">429</th>
                    <th className="font-normal">5xx</th>
                    <th className="font-normal">rej</th>
                    <th className="font-normal">avg</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bySource.map((b) => (
                    <tr key={b.source} className="text-right border-t border-border/40">
                      <td className="text-left py-1.5">{b.source}</td>
                      <td>{b.calls}</td>
                      <td className={rateTone(successRate(b))}>{successRate(b) ?? "—"}%</td>
                      <td className={b.timeouts ? "text-amber-400" : ""}>{b.timeouts}</td>
                      <td className={b.rateLimits ? "text-amber-400" : ""}>{b.rateLimits}</td>
                      <td className={b.upstreamErrors ? "text-red-400" : ""}>{b.upstreamErrors}</td>
                      <td className={b.validationRejects ? "text-amber-400" : ""}>{b.validationRejects}</td>
                      <td>{b.avgLatencyMs != null ? `${b.avgLatencyMs}ms` : "—"}</td>
                    </tr>
                  ))}
                  {data.bySource.length === 0 && (
                    <tr><td colSpan={8} className="py-2 text-left text-muted-foreground font-sans">No AI calls recorded yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {data.topRejections.length > 0 && (
            <div className="mb-5">
              <div className="text-xs text-amber-400 mb-2 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Most common setup rejections
              </div>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {data.topRejections.map((r) => (
                  <li key={r.reason} className="flex justify-between gap-3">
                    <span className="truncate">{r.reason}</span>
                    <span className="font-mono shrink-0">×{r.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground/70 mb-2">Recent calls</div>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {data.recent.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 text-xs py-1.5 border-b border-border/40 last:border-0">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className={cn("h-2 w-2 rounded-full shrink-0", r.status === "ok" ? "bg-emerald-400" : r.status === "validation_reject" ? "bg-amber-400" : "bg-red-400")} />
                    <span className="font-mono shrink-0">{new Date(r.created_at).toLocaleTimeString()}</span>
                    <span className="truncate">{r.source} · {r.status}{r.attempts > 1 ? ` · ${r.attempts} attempts` : ""}</span>
                  </span>
                  <span className="font-mono text-muted-foreground shrink-0">{r.latency_ms != null ? `${r.latency_ms}ms` : "—"}</span>
                </div>
              ))}
              {data.recent.length === 0 && <p className="text-sm text-muted-foreground">Nothing logged yet.</p>}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function Tile({ label, value, tone, icon: Icon }: { label: string; value: string; tone?: string; icon?: typeof Gauge }) {
  return (
    <div className="rounded-lg border border-border/50 p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {Icon && <Icon className="h-3 w-3" />} {label}
      </div>
      <div className={cn("font-display text-lg mt-0.5", tone)}>{value}</div>
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border/50 p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("font-display text-lg mt-0.5", value > 0 ? "text-amber-400" : "text-muted-foreground")}>{value}</div>
    </div>
  );
}
