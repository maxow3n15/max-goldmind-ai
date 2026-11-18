import { SWING_POLICY } from "@/lib/services/swing";

const rules = [
  { label: "Direction", value: "Daily chart trend" },
  { label: "Setup zone", value: "4-hour chart" },
  { label: "Entry signal", value: "Closed 1-hour candle" },
  { label: "Minimum reward", value: `${SWING_POLICY.minRr}× the risk` },
  { label: "Longest hold", value: `${SWING_POLICY.maxHoldHours / 24} days` },
  { label: "Confidence needed", value: `${SWING_POLICY.demoFloor}% demo · ${SWING_POLICY.liveFloor}% real money` },
];

export function SwingPolicyPanel() {
  const [lo, hi] = SWING_POLICY.targetTradesPerWeek;
  return (
    <section className="rounded-xl border border-border/40 bg-card/60 p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Trading style</div>
      <h2 className="mt-1 font-semibold">Swing trading — holds for hours to days</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Aims for about {lo}–{hi} trades a week when the market offers clean setups. Fewer is normal in choppy weeks; it never forces a trade.
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {rules.map((r) => (
          <div key={r.label} className="rounded-lg bg-secondary/40 p-2">
            <dt className="text-[11px] text-muted-foreground">{r.label}</dt>
            <dd className="text-sm font-medium">{r.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">
        After the first target is reached, the stop moves to break-even and then trails behind 4-hour swing points.
      </p>
    </section>
  );
}
