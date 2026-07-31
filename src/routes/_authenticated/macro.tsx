import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getMacroIntel } from "@/lib/macro.functions";
import { getLearningInsights } from "@/lib/learning.functions";
import { MacroSentimentPanel } from "@/components/MacroSentimentPanel";
import { fmtUsd } from "@/lib/format";
import { Brain } from "lucide-react";
import type { MacroReport } from "@/lib/services/macro.types";

export const Route = createFileRoute("/_authenticated/macro")({
  component: MacroPage,
  head: () => ({
    meta: [
      { title: "Market Intelligence · GoldMind AI" },
      { name: "description", content: "Live gold sentiment, USD strength, rate outlook, economic calendar and AI news impact scoring for XAUUSD." },
      { property: "og:title", content: "Market Intelligence · GoldMind AI" },
      { property: "og:description", content: "Real-time macro and news intelligence for XAUUSD: sentiment, dollar strength, rate outlook and event risk." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

function MacroPage() {
  const macroFn = useServerFn(getMacroIntel);
  const learnFn = useServerFn(getLearningInsights);

  const macro = useQuery({
    queryKey: ["macro-intel"],
    queryFn: () => macroFn() as Promise<MacroReport>,
    refetchInterval: 5 * 60_000,
  });
  const learning = useQuery({ queryKey: ["learning"], queryFn: () => learnFn() });

  const l: any = learning.data ?? null;
  const buckets: { title: string; rows: any[] }[] = l
    ? [
        { title: "Macro environment", rows: l.by_macro ?? [] },
        { title: "Confidence band", rows: l.confidence_bands ?? [] },
        { title: "Session", rows: l.by_session ?? [] },
        { title: "Direction", rows: l.by_direction ?? [] },
      ]
    : [];

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto">
      <header>
        <h1 className="font-display text-2xl md:text-3xl font-semibold">Market Intelligence</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Live global financial news, macro conditions and event risk — blended with technical analysis before any trade is taken.
        </p>
      </header>

      <MacroSentimentPanel
        macro={macro.data ?? null}
        loading={macro.isFetching}
        onRefresh={() => macro.refetch()}
      />

      <section className="glass-panel rounded-2xl p-5">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          <h2 className="font-display text-lg font-semibold">Self-improvement engine</h2>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Learned from your own closed trades — which setups, sessions and macro regimes actually pay.
        </p>

        {!l ? (
          <p className="text-sm text-muted-foreground mt-4">{learning.isLoading ? "Analysing trade history…" : "No history yet."}</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 mt-4">
              <div className="glass-panel rounded-xl p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Closed trades</p>
                <p className="text-lg font-semibold tabular-nums">{l.total_closed}</p>
              </div>
              <div className="glass-panel rounded-xl p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Win rate</p>
                <p className="text-lg font-semibold tabular-nums">{l.win_rate}%</p>
              </div>
              <div className="glass-panel rounded-xl p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Net P&amp;L</p>
                <p className="text-lg font-semibold tabular-nums">{fmtUsd(l.net_pnl)}</p>
              </div>
            </div>

            <ul className="mt-4 space-y-1 text-sm text-muted-foreground">
              {(l.lessons ?? []).map((x: string, i: number) => <li key={i}>• {x}</li>)}
            </ul>

            <div className="grid md:grid-cols-2 gap-4 mt-5">
              {buckets.map((b) => (
                <div key={b.title}>
                  <p className="text-xs font-medium mb-2">{b.title}</p>
                  {b.rows.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No data yet.</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground">
                        <tr><th className="text-left font-normal">Key</th><th className="text-right font-normal">Trades</th><th className="text-right font-normal">Win %</th><th className="text-right font-normal">P&amp;L</th></tr>
                      </thead>
                      <tbody>
                        {b.rows.slice(0, 6).map((r: any) => (
                          <tr key={r.key} className="border-t border-border/40">
                            <td className="py-1 pr-2">{r.key}</td>
                            <td className="py-1 text-right tabular-nums">{r.trades}</td>
                            <td className="py-1 text-right tabular-nums">{r.win_rate}%</td>
                            <td className={`py-1 text-right tabular-nums ${r.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmtUsd(r.pnl)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
