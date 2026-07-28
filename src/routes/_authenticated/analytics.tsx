import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listTrades, getAccountSnapshot } from "@/lib/trades.functions";
import { fmtNum, fmtPct, fmtUsd } from "@/lib/format";
import { StatCard } from "@/components/StatCard";

export const Route = createFileRoute("/_authenticated/analytics")({
  component: Analytics,
  head: () => ({
    meta: [
      { title: "Analytics · GoldMind AI" },
      { name: "description", content: "Performance analytics for your XAUUSD trading: win rate, profit factor, drawdown, best sessions." },
    ],
  }),
});

function Analytics() {
  const tFn = useServerFn(listTrades);
  const sFn = useServerFn(getAccountSnapshot);
  const trades = useQuery({ queryKey: ["trades"], queryFn: () => tFn() });
  const snap = useQuery({ queryKey: ["snapshot"], queryFn: () => sFn() });

  const closed = (trades.data ?? []).filter((t: any) => t.status === "closed" && t.pnl != null);
  const wins = closed.filter((t: any) => Number(t.pnl) > 0);
  const losses = closed.filter((t: any) => Number(t.pnl) < 0);
  const grossWin = wins.reduce((a: number, t: any) => a + Number(t.pnl), 0);
  const grossLoss = Math.abs(losses.reduce((a: number, t: any) => a + Number(t.pnl), 0));
  const profitFactor = grossLoss ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;
  const avgRR = closed.length ? closed.reduce((a: number, t: any) => a + Number(t.risk_reward ?? 0), 0) / closed.length : 0;

  // Max drawdown
  let peak = Number(snap.data?.account?.balance ?? 10000);
  let dd = 0;
  let running = peak;
  for (const t of [...closed].reverse()) {
    running -= Number(t.pnl);
    if (running > peak) peak = running;
    const drop = ((peak - running) / peak) * 100;
    if (drop > dd) dd = drop;
  }

  const bySession: Record<string, number> = {};
  closed.forEach((t: any) => { const k = t.session ?? "Unknown"; bySession[k] = (bySession[k] ?? 0) + Number(t.pnl); });
  const bestSession = Object.entries(bySession).sort((a, b) => b[1] - a[1])[0];
  const worstSession = Object.entries(bySession).sort((a, b) => a[1] - b[1])[0];

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto">
      <header>
        <h1 className="font-display text-2xl md:text-3xl font-semibold">Performance Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">Statistical view of your XAUUSD paper trading history.</p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Win rate" tone="gold" value={fmtPct(snap.data?.win_rate ?? 0)} hint={`${wins.length}/${closed.length} closed`} />
        <StatCard label="Profit factor" value={Number.isFinite(profitFactor) ? fmtNum(profitFactor, 2) : "∞"} />
        <StatCard label="Avg R:R" value={fmtNum(avgRR, 2)} />
        <StatCard label="Max drawdown" tone="danger" value={fmtPct(dd, 1)} />
        <StatCard label="Gross win" tone="success" value={fmtUsd(grossWin)} />
        <StatCard label="Gross loss" tone="danger" value={fmtUsd(-grossLoss)} />
        <StatCard label="Best session" tone="success" value={bestSession ? bestSession[0] : "—"} hint={bestSession ? fmtUsd(bestSession[1]) : ""} />
        <StatCard label="Worst session" tone="danger" value={worstSession ? worstSession[0] : "—"} hint={worstSession ? fmtUsd(worstSession[1]) : ""} />
      </div>

      <div className="glass-panel rounded-2xl p-5">
        <h2 className="font-display text-lg font-semibold mb-4">P&L per session</h2>
        {Object.keys(bySession).length === 0 ? (
          <p className="text-sm text-muted-foreground">Not enough data yet.</p>
        ) : (
          <div className="space-y-2">
            {Object.entries(bySession).map(([session, pnl]) => {
              const max = Math.max(...Object.values(bySession).map(Math.abs));
              const pct = max ? (Math.abs(pnl) / max) * 100 : 0;
              return (
                <div key={session}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">{session}</span>
                    <span className={`font-mono ${pnl >= 0 ? "text-[color:var(--success)]" : "text-[color:var(--destructive)]"}`}>{fmtUsd(pnl)}</span>
                  </div>
                  <div className="h-2 bg-secondary rounded-full overflow-hidden">
                    <div className="h-full" style={{ width: `${pct}%`, background: pnl >= 0 ? "var(--success)" : "var(--destructive)" }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
