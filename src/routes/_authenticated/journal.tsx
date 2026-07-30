import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listTrades } from "@/lib/trades.functions";
import { fmtNum, fmtUsd } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/journal")({
  component: Journal,
  head: () => ({
    meta: [
      { title: "Trade Journal · GoldMind AI" },
      { name: "description", content: "Every XAUUSD trade with reasoning, confidence, and outcome." },
      { property: "og:title", content: "Trade Journal · GoldMind AI" },
      { property: "og:description", content: "Review every XAUUSD paper trade with reasoning, confidence and outcome." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

function Journal() {
  const fn = useServerFn(listTrades);
  const q = useQuery({ queryKey: ["trades"], queryFn: () => fn() });

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1400px] mx-auto">
      <header>
        <h1 className="font-display text-2xl md:text-3xl font-semibold">Trade Journal</h1>
        <p className="text-sm text-muted-foreground mt-1">Every idea, entry, exit, and lesson — captured.</p>
      </header>

      <div className="glass-panel rounded-2xl overflow-hidden">
        {q.isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (q.data ?? []).length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">No trades logged yet. Head to the dashboard to open your first paper trade.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-widest text-muted-foreground text-left border-b border-border/50">
                <tr>
                  <th className="p-3">Opened</th><th>Dir</th><th>Entry</th><th>SL</th><th>TP1</th>
                  <th>Exit</th><th>P&L</th><th>Conf</th><th>TF</th><th>Session</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {q.data!.map((t: any) => (
                  <tr key={t.id} className="border-b border-border/30 hover:bg-accent/40">
                    <td className="p-3 text-xs">{new Date(t.opened_at).toLocaleString()}</td>
                    <td className={`font-mono font-semibold ${t.direction === "BUY" ? "text-[color:var(--success)]" : "text-[color:var(--destructive)]"}`}>{t.direction}</td>
                    <td className="font-mono">{fmtNum(t.entry_price, 2)}</td>
                    <td className="font-mono text-[color:var(--destructive)]">{fmtNum(t.stop_loss, 2)}</td>
                    <td className="font-mono text-[color:var(--success)]">{fmtNum(t.take_profit_1, 2)}</td>
                    <td className="font-mono">{t.exit_price ? fmtNum(t.exit_price, 2) : "—"}</td>
                    <td className={`font-mono ${(t.pnl ?? 0) > 0 ? "text-[color:var(--success)]" : (t.pnl ?? 0) < 0 ? "text-[color:var(--destructive)]" : ""}`}>{t.pnl != null ? fmtUsd(t.pnl) : "—"}</td>
                    <td className="font-mono">{Math.round(t.confidence ?? 0)}%</td>
                    <td className="font-mono">{t.timeframe ?? "—"}</td>
                    <td>{t.session ?? "—"}</td>
                    <td>
                      <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${
                        t.status === "open" ? "bg-[color:var(--gold)]/15 text-[color:var(--gold)]" :
                        t.status === "closed" ? "bg-muted text-muted-foreground" : ""
                      }`}>{t.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
