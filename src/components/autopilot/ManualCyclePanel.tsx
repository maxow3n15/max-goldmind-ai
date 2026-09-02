import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Play, ShieldAlert, XOctagon, CheckCircle2 } from "lucide-react";
import {
  approveManualCycle,
  flattenAllPositions,
  runManualCycle,
} from "@/lib/live-control.functions";

const fmt = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v.toFixed(2) : "—";

export function ManualCyclePanel() {
  const runFn = useServerFn(runManualCycle);
  const approveFn = useServerFn(approveManualCycle);
  const flattenFn = useServerFn(flattenAllPositions);

  const [proposal, setProposal] = useState<any | null>(null);
  const [confirmFlatten, setConfirmFlatten] = useState(false);

  const cycle = useMutation({
    mutationFn: () => runFn({}),
    onSuccess: (res: any) => {
      setProposal(res?.proposal ?? null);
      if (!res?.proposal) toast.info("Cycle ran but produced no proposal.");
      else toast.success("Cycle complete — review the proposal below.");
      (res?.errors ?? []).slice(0, 2).forEach((e: string) => toast.warning(e));
    },
    onError: (e: any) => toast.error(e?.message ?? "Cycle failed"),
  });

  const approve = useMutation({
    mutationFn: () => approveFn({ data: { confirm: true } }),
    onSuccess: (res: any) => {
      if (res?.opened > 0) toast.success(`${res.opened} order(s) submitted.`);
      else
        toast.warning(
          res?.proposal?.blocked
            ? `Nothing executed — ${res.proposal.blocked}`
            : "Nothing executed — the setup no longer passes the gates.",
        );
      setProposal(res?.proposal ?? null);
    },
    onError: (e: any) => toast.error(e?.message ?? "Execution failed"),
  });

  const flatten = useMutation({
    mutationFn: () => flattenFn({ data: { confirm: true } }),
    onSuccess: (res: any) => {
      setConfirmFlatten(false);
      toast.success(`Closed ${res.closed} position(s)${res.failed ? `, ${res.failed} failed` : ""}.`);
      (res.results ?? []).filter((r: any) => !r.ok).slice(0, 3)
        .forEach((r: any) => toast.error(`Close failed: ${r.detail}`));
    },
    onError: (e: any) => toast.error(e?.message ?? "Flatten failed"),
  });

  const blocked = proposal?.blocked && !String(proposal.blocked).startsWith("dry run");

  return (
    <div className="glass-panel rounded-xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium flex items-center gap-2">
            <Play className="h-4 w-4 text-[color:var(--gold)]" /> Manual cycle
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Runs the full decision pipeline once against live data and shows what it would do.
            Nothing is submitted until you approve — and approval re-runs every gate at that moment.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => cycle.mutate()}
            disabled={cycle.isPending}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-[color:var(--gold)] disabled:opacity-50"
          >
            {cycle.isPending ? "Running…" : "Run cycle now"}
          </button>
          <button
            type="button"
            onClick={() => (confirmFlatten ? flatten.mutate() : setConfirmFlatten(true))}
            disabled={flatten.isPending}
            className="rounded-md border border-destructive/60 text-destructive px-3 py-1.5 text-xs hover:bg-destructive/10 disabled:opacity-50"
          >
            <span className="inline-flex items-center gap-1.5">
              <XOctagon className="h-3.5 w-3.5" />
              {flatten.isPending ? "Closing…" : confirmFlatten ? "Confirm close all" : "Close all positions"}
            </span>
          </button>
        </div>
      </div>

      {proposal && (
        <div className="rounded-lg border border-border p-3 space-y-3 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium text-sm">
              {proposal.direction ?? "No direction"} · {proposal.setup_model?.replaceAll("_", " ").toLowerCase() ?? "no setup model"}
            </span>
            <span className="text-muted-foreground">
              confidence {fmt(proposal.confidence)}% · price {fmt(proposal.price)} · spread {fmt(proposal.spread)}
            </span>
            <span className="text-muted-foreground">
              mode {proposal.trading_mode}{proposal.broker_environment ? ` (${proposal.broker_environment})` : ""}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {[
              ["Entry", proposal.entry],
              ["Stop", proposal.stop_loss],
              ["TP1", proposal.take_profit_1],
              ["TP2", proposal.take_profit_2],
              ["TP3", proposal.take_profit_3],
            ].map(([label, v]) => (
              <div key={String(label)} className="rounded-md bg-muted/30 px-2 py-1.5">
                <div className="text-[10px] text-muted-foreground">{label}</div>
                <div className="font-mono">{fmt(v)}</div>
              </div>
            ))}
          </div>

          {Array.isArray(proposal.plans) && proposal.plans.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Ladder</div>
              {proposal.plans.map((p: any, i: number) => (
                <div key={i} className="flex justify-between gap-3 font-mono">
                  <span>leg {i + 1} · {p.lot_size} lots</span>
                  <span className="text-muted-foreground">
                    SL {fmt(p.stop_loss)} → TP {fmt(p.take_profit_1 ?? p.take_profit)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {proposal.explanation && (
            <p className="text-muted-foreground">{proposal.explanation}</p>
          )}

          {Array.isArray(proposal.blockers) && proposal.blockers.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <ShieldAlert className="h-3 w-3" /> Blocked by
              </div>
              <ul className="list-disc pl-4 text-destructive/90">
                {proposal.blockers.map((b: string) => <li key={b}>{b}</li>)}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => approve.mutate()}
              disabled={approve.isPending || blocked || !proposal.plans?.length}
              className="rounded-md bg-[color:var(--gold)] text-background px-3 py-1.5 text-xs font-medium disabled:opacity-40"
            >
              {approve.isPending ? "Executing…" : "Execute this setup"}
            </button>
            <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" />
              Execution re-runs the pipeline; a setup that has since invalidated will not fill.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
