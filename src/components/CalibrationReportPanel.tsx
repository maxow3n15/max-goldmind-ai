// Permanent walk-forward calibration report.
//
// Surfaces sample size and in-sample vs out-of-sample performance for every
// setup model, so threshold/weight calibration stays visible and auditable
// rather than being a one-time exercise.

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Microscope, Play, AlertTriangle } from "lucide-react";
import { runCalibrationStudy } from "@/lib/calibration-study.functions";

const TIMEFRAMES = ["15", "30", "60", "240"] as const;

function Cell({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${muted ? "text-muted-foreground" : ""}`}>{value}</div>
    </div>
  );
}

export function CalibrationReportPanel() {
  const studyFn = useServerFn(runCalibrationStudy);
  const [timeframe, setTimeframe] = useState<(typeof TIMEFRAMES)[number]>("60");
  const [chunks, setChunks] = useState(4);
  const [researchFloor, setResearchFloor] = useState(88);
  const [longHistoryDays, setLongHistoryDays] = useState(0);
  const [report, setReport] = useState<any | null>(null);

  const run = useMutation({
    mutationFn: () => studyFn({ data: { timeframe, chunks, researchFloor, realCorrelation: true, longHistoryDays } }),
    onSuccess: (res: any) => {
      if (!res?.ok) { toast.error(res?.reason ?? "Study failed"); return; }
      setReport(res);
      toast.success(`Walk-forward study over ${res.bars} bars complete`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Study failed"),
  });

  const insufficient = report && report.inSample.trades + report.outOfSample.trades < report.minMeaningfulSample;

  return (
    <div className="glass-panel rounded-xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display text-lg font-semibold flex items-center gap-2">
            <Microscope className="h-4 w-4 text-[color:var(--gold)]" /> Walk-forward calibration
          </h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
            Splits history into sequential chunks, calibrates on the leading chunks and reports the held-out final
            chunk separately. Any setup model with fewer than 30 closed trades is flagged as statistically
            meaningless and must not drive tuning.
          </p>
        </div>
        <button
          onClick={() => run.mutate()}
          disabled={run.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-[color:var(--gold)]/15 border border-[color:var(--gold)]/40 px-3 py-2 text-sm font-medium hover:bg-[color:var(--gold)]/25 disabled:opacity-50"
        >
          <Play className="h-4 w-4" /> {run.isPending ? "Running…" : "Run study"}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <label className="text-xs space-y-1">
          <span className="text-muted-foreground">Timeframe</span>
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value as any)}
            className="w-full rounded-lg bg-background/60 border border-border px-2 py-2 text-sm"
          >
            {TIMEFRAMES.map((t) => <option key={t} value={t}>{t}m</option>)}
          </select>
        </label>
        <label className="text-xs space-y-1">
          <span className="text-muted-foreground">Chunks (last one is held out)</span>
          <input
            type="number" min={4} max={8} value={chunks}
            onChange={(e) => setChunks(Math.max(4, Math.min(8, Number(e.target.value) || 4)))}
            className="w-full rounded-lg bg-background/60 border border-border px-2 py-2 text-sm tabular-nums"
          />
        </label>
        <label className="text-xs space-y-1">
          <span className="text-muted-foreground">Measurement floor (replay only)</span>
          <input
            type="number" min={50} max={99} value={researchFloor}
            onChange={(e) => setResearchFloor(Math.max(50, Math.min(99, Number(e.target.value) || 88)))}
            className="w-full rounded-lg bg-background/60 border border-border px-2 py-2 text-sm tabular-nums"
          />
        </label>
        <label className="text-xs space-y-1">
          <span className="text-muted-foreground">History days (0 = default)</span>
          <input
            type="number" min={0} max={2922} value={longHistoryDays}
            onChange={(e) => setLongHistoryDays(Math.max(0, Math.min(2922, Number(e.target.value) || 0)))}
            className="w-full rounded-lg bg-background/60 border border-border px-2 py-2 text-sm tabular-nums"
          />
        </label>
      </div>

      <p className="text-[11px] text-muted-foreground">
        The measurement floor changes this replay only. The live confidence gate, risk/reward minimum, loss limits
        and kill switch are never affected by anything on this panel.
      </p>

      {report && (
        <div className="space-y-4 pt-2 border-t border-border/60">
          <div className="text-xs text-muted-foreground">
            {report.bars} bars · {report.from} → {report.to} · live gate {report.liveFloor}% · measured at {report.researchFloor}%
          </div>

          <div className={`rounded-lg p-3 text-xs flex gap-2 ${insufficient ? "bg-amber-500/10 border border-amber-500/30" : "bg-muted/30 border border-border"}`}>
            <AlertTriangle className={`h-4 w-4 shrink-0 ${insufficient ? "text-amber-400" : "text-muted-foreground"}`} />
            <span>{report.verdict}</span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {[["In-sample (training chunks)", report.inSample], ["Out-of-sample (held out)", report.outOfSample]].map(([label, a]: any) => (
              <div key={label} className="rounded-lg border border-border p-3 space-y-2">
                <div className="text-xs font-medium">{label}</div>
                <div className="grid grid-cols-4 gap-2">
                  <Cell label="Trades" value={String(a.trades)} muted={a.trades < report.minMeaningfulSample} />
                  <Cell label="Win rate" value={`${a.winRate}%`} />
                  <Cell label="Expectancy" value={`${a.expectancyR}R`} />
                  <Cell label="Net P&L" value={`${a.netPnl}`} />
                </div>
              </div>
            ))}
          </div>

          <div>
            <div className="text-xs font-medium mb-2">Per-chunk</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="text-left">
                    {["Chunk", "Window", "Role", "Candidates", "Approved", "Trades", "Win %", "Exp R", "Max DD %", "Conf p90/max"].map((h) => (
                      <th key={h} className="py-1 pr-3 font-normal">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {report.chunks.map((c: any) => (
                    <tr key={c.chunk} className="border-t border-border/50">
                      <td className="py-1 pr-3">{c.chunk}</td>
                      <td className="py-1 pr-3 whitespace-nowrap">{c.from} → {c.to}</td>
                      <td className="py-1 pr-3">
                        <span className={c.role === "holdout" ? "text-[color:var(--gold)]" : "text-muted-foreground"}>{c.role}</span>
                      </td>
                      <td className="py-1 pr-3">{c.candidates}</td>
                      <td className="py-1 pr-3">{c.approved}</td>
                      <td className="py-1 pr-3">{c.trades}</td>
                      <td className="py-1 pr-3">{c.winRate}</td>
                      <td className="py-1 pr-3">{c.expectancyR}</td>
                      <td className="py-1 pr-3">{c.maxDrawdownPct}</td>
                      <td className="py-1 pr-3">{c.confidenceP90}/{c.confidenceMax}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <div className="text-xs font-medium mb-2">Setup model validity</div>
            {report.models.length === 0 ? (
              <p className="text-xs text-muted-foreground">No setup model produced a closed trade in this study.</p>
            ) : (
              <div className="space-y-2">
                {report.models.map((m: any) => (
                  <div key={m.model} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-xs font-semibold">{m.model.replaceAll("_", " ")}</span>
                      {!m.sufficientSample && (
                        <span className="text-[10px] rounded px-2 py-0.5 bg-amber-500/15 text-amber-400 border border-amber-500/30">
                          insufficient sample — not statistically meaningful
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                      <Cell label="IS trades" value={String(m.inSample?.trades ?? 0)} />
                      <Cell label="IS win / exp" value={`${m.inSample?.winRate ?? 0}% · ${m.inSample?.expectancyR ?? 0}R`} />
                      <Cell label="OOS trades" value={String(m.outOfSample?.trades ?? 0)} />
                      <Cell label="OOS win / exp" value={`${m.outOfSample?.winRate ?? 0}% · ${m.outOfSample?.expectancyR ?? 0}R`} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {report.dataFidelity && (
            <div className="rounded-md border border-border/60 p-3">
              <div className="text-xs font-medium mb-2">Replay data fidelity</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Cell
                  label="Bars with degraded MTF"
                  value={`${Math.round(report.dataFidelity.mtfDegradedFraction * 100)}%`}
                />
                <Cell
                  label="HTF alignment scored"
                  value={report.dataFidelity.htfAlignmentVerdicts
                    .map((v: any) => `${v.verdict} ${v.count}`)
                    .join(" · ") || "—"}
                />
              </div>
              <div className="mt-2 text-[11px] text-muted-foreground space-y-0.5">
                <div>
                  Sub-execution history loaded:{" "}
                  {report.dataFidelity.finerSeriesLoaded.join(", ") || "none"}
                </div>
                {report.dataFidelity.finerSeriesMissing.length > 0 && (
                  <div>
                    Unavailable: {report.dataFidelity.finerSeriesMissing.join(", ")} — the
                    higher-timeframe alignment factor is weakened on affected bars.
                  </div>
                )}
              </div>
            </div>
          )}

          <div>
            <div className="text-xs font-medium mb-2">What blocked trades</div>
            <div className="space-y-1">
              {report.rejections.map((r: any) => (
                <div key={r.reason} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{r.reason}</span>
                  <span className="tabular-nums">{r.count}</span>
                </div>
              ))}
            </div>
          </div>

          <ul className="text-[11px] text-muted-foreground list-disc pl-4 space-y-0.5">
            {report.caveats.map((c: string) => <li key={c}>{c}</li>)}
            <li>Historical, backtested performance only. Nothing here implies future profitability.</li>
          </ul>
        </div>
      )}
    </div>
  );
}
