import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getForensics } from "@/lib/forensics.functions";
import { fmtNum } from "@/lib/format";

/**
 * Trade forensics and confidence calibration.
 *
 * Win rate says whether the account made money. These two panels say
 * *why*: how much of each move the exits actually banked, whether the
 * stops were placed where winners could survive them, and whether the
 * engine's stated confidence means anything at all once it's checked
 * against realised outcomes.
 */
export function ForensicsPanels() {
  const fn = useServerFn(getForensics);
  const q = useQuery({ queryKey: ["forensics"], queryFn: () => fn(), staleTime: 60_000 });

  const f = q.data?.forensics ?? null;
  const c = q.data?.calibration ?? null;

  return (
    <div className="grid gap-6 lg:grid-cols-2 items-start">
      {/* ---------------- Excursion forensics ---------------- */}
      <section className="glass-panel rounded-2xl p-5">
        <header className="flex items-baseline justify-between mb-4">
          <h2 className="font-display text-lg font-semibold">Trade forensics</h2>
          <span className="text-xs text-muted-foreground">
            {f ? `${f.sample} trades with excursion data` : "loading"}
          </span>
        </header>

        {!f || f.sample === 0 ? (
          <p className="text-sm text-muted-foreground">
            No excursion data yet. Once trades open and close with the engine running, every position's
            worst and best unrealised move is recorded and analysed here.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <Metric label="Capture efficiency" value={f.capture_efficiency != null ? `${fmtNum(f.capture_efficiency, 0)}%` : "—"} hint="of the offered move" />
              <Metric label="Avg heat (MAE)" value={f.avg_mae_r != null ? `${fmtNum(f.avg_mae_r, 2)}R` : "—"} hint="worst drawdown" />
              <Metric label="Avg peak (MFE)" value={f.avg_mfe_r != null ? `${fmtNum(f.avg_mfe_r, 2)}R` : "—"} hint="best unrealised" />
              <Metric label="Stop survival" value={f.stop_survival_r != null ? `${fmtNum(f.stop_survival_r, 2)}R` : "—"} hint="keeps 90% of winners" />
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs mb-4">
              <Row label="Winners' avg heat" value={f.avg_mae_r_winners != null ? `${fmtNum(f.avg_mae_r_winners, 2)}R` : "—"} />
              <Row label="Losers' avg heat" value={f.avg_mae_r_losers != null ? `${fmtNum(f.avg_mae_r_losers, 2)}R` : "—"} />
              <Row label="Gave back 1R+" value={String(f.gave_back_winners)} />
              <Row label="Wrong from entry" value={String(f.immediately_wrong)} />
              <Row label="Clean entries" value={String(f.clean_entries)} />
              <Row
                label="Hold W/L (min)"
                value={
                  f.hold_minutes_winners != null && f.hold_minutes_losers != null
                    ? `${fmtNum(f.hold_minutes_winners, 0)} / ${fmtNum(f.hold_minutes_losers, 0)}`
                    : "—"
                }
              />
            </dl>

            <ul className="space-y-2">
              {f.findings.map((t, i) => (
                <li key={i} className="text-xs text-muted-foreground leading-relaxed pl-3 border-l-2 border-[color:var(--border)]">
                  {t}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* ---------------- Confidence calibration ---------------- */}
      <section className="glass-panel rounded-2xl p-5">
        <header className="flex items-baseline justify-between mb-4">
          <h2 className="font-display text-lg font-semibold">Confidence calibration</h2>
          <span className="text-xs text-muted-foreground">{c ? `${c.sample} scored trades` : "loading"}</span>
        </header>

        {!c || c.sample === 0 ? (
          <p className="text-sm text-muted-foreground">
            Calibration compares what the AI claimed against what actually happened. It needs a run of
            closed, confidence-scored trades before the comparison is meaningful.
          </p>
        ) : (
          <>
            <p className="text-sm mb-4">{c.verdict}</p>

            <div className="grid grid-cols-3 gap-3 mb-4">
              <Metric label="Brier score" value={c.brier != null ? fmtNum(c.brier, 3) : "—"} hint="lower is better" />
              <Metric label="Calibration error" value={c.ece != null ? `${fmtNum(c.ece, 1)}pts` : "—"} hint="claim vs reality" />
              <Metric
                label="Bias"
                value={c.bias != null ? `${c.bias > 0 ? "+" : ""}${fmtNum(c.bias, 1)}pts` : "—"}
                hint={c.bias != null && c.bias > 0 ? "over-confident" : "conservative"}
              />
            </div>

            <div className="space-y-2 mb-4">
              {c.bins.map((b) => (
                <div key={b.label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">{b.label}</span>
                    <span className="font-mono">
                      {b.trades === 0
                        ? "no trades"
                        : `claimed ${fmtNum(b.predicted, 0)}% · delivered ${b.actual != null ? `${fmtNum(b.actual, 0)}%` : "—"} · n=${b.trades}`}
                    </span>
                  </div>
                  {/* Claimed confidence sits behind; realised win rate in front. */}
                  <div className="relative h-2 bg-secondary rounded-full overflow-hidden">
                    <div className="absolute inset-y-0 left-0 opacity-30" style={{ width: `${b.predicted}%`, background: "var(--primary)" }} />
                    <div
                      className="absolute inset-y-0 left-0"
                      style={{
                        width: `${b.actual ?? 0}%`,
                        background: (b.gap ?? 0) > 10 ? "var(--destructive)" : "var(--success)",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {c.notes.length > 0 && (
              <ul className="space-y-2">
                {c.notes.map((n, i) => (
                  <li key={i} className="text-xs text-muted-foreground leading-relaxed pl-3 border-l-2 border-[color:var(--border)]">
                    {n}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-secondary/40 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-mono text-lg mt-0.5">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono text-right">{value}</dd>
    </>
  );
}
