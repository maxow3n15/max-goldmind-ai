import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Brain, Compass, ShieldCheck, Gauge, Ban } from "lucide-react";
import { useAutopilotContext } from "@/providers/AutopilotProvider";
import { getChallengeStatus } from "@/lib/challenge.functions";
import { getForensics } from "@/lib/forensics.functions";
import { getLearningInsights, getNoTradeInsights } from "@/lib/learning.functions";
import { REGIME_LABEL } from "@/lib/services/environment";
import { TIER_LABEL } from "@/lib/services/adaptive";
import { fmtPct, fmtUsd } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/intelligence")({
  component: IntelligencePage,
  head: () => ({
    meta: [
      { title: "Intelligence · GoldMind AI" },
      { name: "description", content: "One view of the market environment, funded-challenge compliance, confidence calibration, capital-preservation tier and what the engine declined to trade." },
      { property: "og:title", content: "Intelligence · GoldMind AI" },
      { property: "og:description", content: "Environment classification, calibration verdict, preservation tier and no-trade intelligence for GoldMind AI." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

function Panel({ title, icon: Icon, children }: { title: string; icon: any; children: any }) {
  return (
    <section className="glass-panel rounded-2xl p-5 space-y-3">
      <h2 className="text-sm font-medium flex items-center gap-2">
        <Icon className="h-4 w-4 text-[color:var(--gold)]" /> {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: any }) {
  return (
    <div className="flex items-center justify-between text-xs border-t border-border/40 pt-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function IntelligencePage() {
  const a = useAutopilotContext();

  const challengeFn = useServerFn(getChallengeStatus);
  const forensicsFn = useServerFn(getForensics);
  const learningFn = useServerFn(getLearningInsights);
  const noTradeFn = useServerFn(getNoTradeInsights);

  const challenge = useQuery({ queryKey: ["challenge-status", null], queryFn: () => challengeFn({ data: {} }) });
  const forensics = useQuery({ queryKey: ["forensics"], queryFn: () => forensicsFn() });
  const learning = useQuery({ queryKey: ["learning-insights"], queryFn: () => learningFn() });
  const noTrade = useQuery({ queryKey: ["no-trade-insights"], queryFn: () => noTradeFn() });

  const env = a.environment;
  const status: any = challenge.data?.status ?? null;
  const calibration: any = (forensics.data as any)?.calibration ?? null;
  const byEnv: any[] = (learning.data as any)?.by_environment ?? [];
  const nt: any = noTrade.data ?? null;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto">
      <header>
        <h1 className="font-display text-2xl md:text-3xl font-semibold flex items-center gap-2">
          <Brain className="h-6 w-6 text-[color:var(--gold)]" /> Intelligence
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Everything the engine currently believes about the market and about itself, in one place. Every number here
          is derived from your own stored trades and decision log — nothing is estimated.
        </p>
      </header>

      <div className="grid lg:grid-cols-2 gap-4">
        <Panel title="Market environment" icon={Compass}>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-md bg-secondary px-2 py-1">{REGIME_LABEL[env.regime]} · {env.regime_confidence}%</span>
            <span className="rounded-md bg-secondary px-2 py-1">{env.volatility_state} volatility · {env.volatility_confidence}%</span>
            <span className="rounded-md bg-secondary px-2 py-1">{env.news_impact} news impact · {env.news_impact_confidence}%</span>
            {env.abnormal && (
              <span className="rounded-md px-2 py-1 bg-[color:var(--destructive)]/15 text-[color:var(--destructive)]">
                Outside normal operating envelope
              </span>
            )}
          </div>
          <ul className="space-y-1 text-xs text-muted-foreground leading-relaxed">
            {env.notes.map((n, i) => <li key={i}>· {n}</li>)}
          </ul>
          {a.environmentTrackRecord ? (
            <Row
              label="Your record in this environment"
              value={`${a.environmentTrackRecord.winRate}% win rate over ${a.environmentTrackRecord.trades} trades`}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              No closed trades recorded in this environment yet — it is not influencing sizing.
            </p>
          )}
        </Panel>

        <Panel title="Capital preservation" icon={Gauge}>
          <Row label="Tier" value={TIER_LABEL[a.adaptive.tier]} />
          <Row label="Account health" value={`${a.adaptive.health}/100`} />
          <Row label="Confidence gate in force" value={`${a.adaptive.confidenceThreshold}%`} />
          <Row label="Size multiplier" value={`${Math.round(a.adaptive.sizeMultiplier * 100)}%`} />
          <ul className="space-y-1 text-xs text-muted-foreground leading-relaxed pt-1">
            {a.adaptive.reasons.map((r, i) => <li key={i}>· {r}</li>)}
          </ul>
        </Panel>

        <Panel title="Funded challenge" icon={ShieldCheck}>
          {status ? (
            <>
              <Row label="Posture" value={status.posture} />
              <Row label="Pass probability" value={status.passProbability != null ? `${status.passProbability}%` : "Not enough data yet"} />
              <Row label="Health" value={`${status.health}/100`} />
              <Row label="Daily budget used" value={fmtPct(status.daily.usedPct)} />
              <Row label="Drawdown used" value={fmtPct(status.drawdown.usedPct)} />
              <Row label="Risk allowed next trade" value={`${status.maxRiskPctForNextTrade}%`} />
            </>
          ) : (
            <p className="text-xs text-muted-foreground">No challenge account configured.</p>
          )}
        </Panel>

        <Panel title="Confidence calibration" icon={Brain}>
          {calibration && calibration.sample >= 20 ? (
            <>
              <Row label="Sample" value={`${calibration.sample} closed trades`} />
              <Row label="Verdict" value={calibration.reliable ? "Well calibrated" : "Not yet reliable"} />
              <Row label="Bias" value={calibration.bias != null ? `${calibration.bias.toFixed(1)} pts` : "—"} />
              <Row label="Reliable from" value={calibration.reliable_threshold != null ? `${calibration.reliable_threshold}%` : "—"} />
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Not enough closed trades yet to judge whether confidence scores are honest (20+ needed).
            </p>
          )}
        </Panel>

        <Panel title="Performance by environment" icon={Compass}>
          {byEnv.length ? (
            <div className="space-y-2">
              {byEnv.map((b) => (
                <div key={b.key} className="flex items-center justify-between text-xs border-t border-border/40 pt-2">
                  <span className="truncate pr-3">{b.key}</span>
                  <span className="tabular-nums whitespace-nowrap">
                    {b.win_rate}% · {b.trades} trades · {fmtUsd(b.pnl)}
                  </span>
                </div>
              ))}
              <p className="text-[11px] text-muted-foreground pt-1">
                Environments with fewer than 8 closed trades do not yet influence the confidence gate.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No closed trades carry an environment label yet.</p>
          )}
        </Panel>

        <Panel title="No-trade intelligence" icon={Ban}>
          {nt ? (
            <>
              <Row label="Cycles logged (30d)" value={nt.cycles_logged} />
              <Row label="Stood down" value={`${nt.rejected_count} (${nt.rejection_rate}%)`} />
              <Row label="Executed" value={nt.executed_count} />
              <div className="pt-2 space-y-1">
                {nt.top_blockers.map((b: any) => (
                  <div key={b.key} className="flex items-center justify-between text-xs">
                    <span className="truncate pr-3 text-muted-foreground">{b.key}</span>
                    <span className="tabular-nums">{b.count}</span>
                  </div>
                ))}
              </div>
              <ul className="space-y-1 text-xs text-muted-foreground pt-1">
                {nt.notes.map((n: string, i: number) => <li key={i}>· {n}</li>)}
              </ul>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Loading decision log…</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
