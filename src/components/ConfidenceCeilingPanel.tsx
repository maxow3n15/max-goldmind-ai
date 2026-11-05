import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Layers } from "lucide-react";
import { listConfidenceCeiling, type ConfidenceCeilingCycle } from "@/lib/decision-log.functions";
import { FACTOR_LABELS, type FactorKey } from "@/lib/services/confidence-engine";
import { cn } from "@/lib/utils";

const FACTOR_ORDER = Object.keys(FACTOR_LABELS) as FactorKey[];

type Verdict = "pass" | "partial" | "fail" | "unavailable" | "missing";

const CELL_TONE: Record<Verdict, string> = {
  pass: "bg-[color:var(--gold)]/80 text-black",
  partial: "bg-muted text-muted-foreground",
  fail: "bg-red-500/80 text-white",
  unavailable: "bg-muted/40 text-muted-foreground/60",
  missing: "bg-transparent text-muted-foreground/40",
};

const CELL_MARK: Record<Verdict, string> = {
  pass: "✓",
  partial: "◐",
  fail: "✕",
  unavailable: "–",
  missing: "·",
};

function factorMap(cycle: ConfidenceCeilingCycle) {
  const map = new Map<string, NonNullable<ConfidenceCeilingCycle["factors"]>[number]>();
  for (const f of cycle.factors ?? []) map.set(f.key, f);
  return map;
}

/** Rank factors by how often they fail across the sampled cycles. */
function worstFactors(cycles: ConfidenceCeilingCycle[]) {
  const stats = new Map<string, { fails: number; partials: number; seen: number }>();
  for (const cycle of cycles) {
    const map = factorMap(cycle);
    for (const key of FACTOR_ORDER) {
      const f = map.get(key);
      if (!f) continue;
      const s = stats.get(key) ?? { fails: 0, partials: 0, seen: 0 };
      s.seen += 1;
      if (f.verdict === "fail") s.fails += 1;
      if (f.verdict === "partial") s.partials += 1;
      stats.set(key, s);
    }
  }
  return [...stats.entries()]
    .filter(([, s]) => s.fails > 0 || s.partials > 0)
    .sort((a, b) => b[1].fails - a[1].fails || b[1].partials - a[1].partials)
    .slice(0, 3);
}

export function ConfidenceCeilingPanel() {
  const fetchCeiling = useServerFn(listConfidenceCeiling);
  const { data, isLoading } = useQuery({
    queryKey: ["confidence-ceiling"],
    queryFn: () => fetchCeiling(),
    refetchInterval: 60_000,
  });

  const cycles = data ?? [];
  const withFactors = cycles.filter((c) => c.factors && c.factors.length > 0);
  const worst = worstFactors(withFactors);

  return (
    <section className="glass-panel p-5">
      <h2 className="font-display font-semibold mb-1 flex items-center gap-2">
        <Layers className="h-4 w-4 text-[color:var(--gold)]" /> Confidence ceiling
      </h2>
      <p className="text-xs text-muted-foreground mb-3">
        Your 10 highest-confidence cycles from the last 30 days, scored factor by factor. This shows what is
        capping confidence below the live gate.
      </p>

      {isLoading && <p className="text-sm text-muted-foreground">Loading decision logs…</p>}

      {!isLoading && cycles.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No scored cycles in the last 30 days — the engine logs every evaluation here once it runs.
        </p>
      )}

      {withFactors.length > 0 && (
        <>
          {worst.length > 0 && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
              <div className="text-xs uppercase tracking-wider text-red-400/90 mb-1.5">Biggest caps on confidence</div>
              <ul className="space-y-1 text-xs">
                {worst.map(([key, s]) => (
                  <li key={key} className="flex items-center justify-between gap-3">
                    <span>{FACTOR_LABELS[key as FactorKey] ?? key}</span>
                    <span className="font-mono text-muted-foreground">
                      {s.fails > 0 && <span className="text-red-400">{s.fails} fail</span>}
                      {s.fails > 0 && s.partials > 0 && " · "}
                      {s.partials > 0 && <span className="text-muted-foreground">{s.partials} partial</span>}
                      <span className="text-muted-foreground/60"> / {s.seen} cycles</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr>
                  <th className="text-left font-normal text-muted-foreground/70 uppercase tracking-wider text-[10px] pr-3 pb-2 align-bottom">
                    Cycle
                  </th>
                  {FACTOR_ORDER.map((key) => (
                    <th
                      key={key}
                      className="pb-2 px-1 align-bottom"
                      title={FACTOR_LABELS[key]}
                    >
                      <div className="rotate-180 [writing-mode:vertical-rl] text-[10px] uppercase tracking-wider text-muted-foreground/70 whitespace-nowrap h-24">
                        {FACTOR_LABELS[key]}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cycles.map((cycle) => {
                  const map = factorMap(cycle);
                  return (
                    <tr key={cycle.cycleId} className="border-t border-border/40">
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        <div className="font-mono text-[11px]">
                          {new Date(cycle.decidedAt).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                        <div className="font-mono text-[11px] text-[color:var(--gold)]">{cycle.confidence}%</div>
                      </td>
                      {FACTOR_ORDER.map((key) => {
                        const f = map.get(key);
                        const verdict: Verdict = f ? f.verdict : cycle.factors ? "unavailable" : "missing";
                        return (
                          <td key={key} className="px-1 py-1.5">
                            <div
                              className={cn(
                                "h-7 w-full min-w-7 rounded flex items-center justify-center font-mono text-[11px]",
                                CELL_TONE[verdict],
                              )}
                              title={
                                f
                                  ? `${FACTOR_LABELS[key] ?? f.key}: ${f.verdict} — ${f.points}/${f.weight} pts. ${f.detail}`
                                  : cycle.factors
                                    ? "Not evaluated in this cycle"
                                    : "Factors not recorded for this cycle"
                              }
                            >
                              {CELL_MARK[verdict]}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-4 mt-3 text-[10px] uppercase tracking-wider text-muted-foreground/70">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded bg-[color:var(--gold)]/80" /> pass</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded bg-muted" /> partial</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded bg-red-500/80" /> fail</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded bg-muted/40" /> n/a</span>
          </div>
        </>
      )}

      {!isLoading && cycles.length > 0 && withFactors.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {cycles.length} scored cycles found, but none recorded per-factor verdicts. Factor-level logging is now
          enabled for server-side cycles — new evaluations will populate this grid automatically.
        </p>
      )}
    </section>
  );
}
