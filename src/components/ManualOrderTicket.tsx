import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Hand } from "lucide-react";
import { openManualPaperTrade } from "@/lib/trades.functions";
import { placeLiveOrder } from "@/lib/brokers.functions";
import { currentSession } from "@/lib/format";

interface Props {
  mode: "paper" | "live";
  timeframe: string;
  price?: number | null;
  environment?: string | null;
}

/**
 * Manual order ticket.
 *
 * Manual entries skip the AI gates (there is no AI setup behind them) but
 * still go through the same account-protection checks as any other order,
 * and once open they are managed by the position manager exactly like an
 * autopilot trade.
 */
export function ManualOrderTicket({ mode, timeframe, price, environment }: Props) {
  const qc = useQueryClient();
  const paperFn = useServerFn(openManualPaperTrade);
  const liveFn = useServerFn(placeLiveOrder);

  const [direction, setDirection] = useState<"BUY" | "SELL">("BUY");
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [tp1, setTp1] = useState("");
  const [tp2, setTp2] = useState("");
  const [tp3, setTp3] = useState("");
  const [lots, setLots] = useState("0.01");
  const [note, setNote] = useState("");

  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  const submit = useMutation({
    mutationFn: async () => {
      const entry_price = num(entry) ?? price ?? null;
      const stop_loss = num(stop);
      const lot_size = num(lots);
      if (!entry_price || !stop_loss || !lot_size) throw new Error("Entry, stop loss and size are required.");

      const payload = {
        direction,
        entry_price,
        stop_loss,
        take_profit_1: num(tp1),
        take_profit_2: num(tp2),
        take_profit_3: num(tp3),
        lot_size,
        timeframe,
        session: currentSession(),
        environment: environment ?? null,
      };

      const res: any =
        mode === "live"
          ? await liveFn({ data: { ...payload, source: "manual", reason_entry: note ? `Manual entry — ${note}` : "Manual entry" } })
          : await paperFn({ data: { ...payload, note: note || undefined } });

      if (res?.ok === false) throw new Error(res.reason ?? "Order blocked");
      return res;
    },
    onSuccess: () => {
      toast.success(`Manual ${mode} order opened`);
      setNote("");
      qc.invalidateQueries({ queryKey: ["trades"] });
      qc.invalidateQueries({ queryKey: ["snapshot"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not place the order"),
  });

  const input = "w-full bg-background border border-border rounded-md px-2 py-2 text-sm tabular-nums";

  return (
    <div className="glass-panel rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium flex items-center gap-2">
          <Hand className="h-4 w-4 text-[color:var(--gold)]" /> Manual order ticket
        </h2>
        <span className="text-[11px] text-muted-foreground uppercase tracking-wide">{mode} mode</span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        Your own entry, sized by you. It skips the AI confidence and R:R gates, still respects the kill switch,
        the max-open-position limit and (in live mode) the broker connection — and is trailed, moved to break-even
        and closed by the same position manager as autopilot trades.
      </p>

      <div className="grid grid-cols-2 gap-2">
        {(["BUY", "SELL"] as const).map((d) => (
          <button
            key={d}
            onClick={() => setDirection(d)}
            className={`rounded-md px-3 py-2 text-sm font-medium border transition-colors ${
              direction === d
                ? d === "BUY"
                  ? "border-[color:var(--success)] text-[color:var(--success)] bg-[color:var(--success)]/10"
                  : "border-[color:var(--destructive)] text-[color:var(--destructive)] bg-[color:var(--destructive)]/10"
                : "border-border text-muted-foreground hover:bg-accent"
            }`}
          >
            {d}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs space-y-1.5 block">
          <span className="text-muted-foreground">Entry {price ? `(live ${price.toFixed(2)})` : ""}</span>
          <input className={input} inputMode="decimal" value={entry} placeholder={price ? price.toFixed(2) : "0.00"}
            onChange={(e) => setEntry(e.target.value)} />
        </label>
        <label className="text-xs space-y-1.5 block">
          <span className="text-muted-foreground">Stop loss</span>
          <input className={input} inputMode="decimal" value={stop} onChange={(e) => setStop(e.target.value)} />
        </label>
        <label className="text-xs space-y-1.5 block">
          <span className="text-muted-foreground">Size (lots)</span>
          <input className={input} inputMode="decimal" value={lots} onChange={(e) => setLots(e.target.value)} />
        </label>
        <label className="text-xs space-y-1.5 block">
          <span className="text-muted-foreground">Take profit 1</span>
          <input className={input} inputMode="decimal" value={tp1} onChange={(e) => setTp1(e.target.value)} />
        </label>
        <label className="text-xs space-y-1.5 block">
          <span className="text-muted-foreground">Take profit 2</span>
          <input className={input} inputMode="decimal" value={tp2} onChange={(e) => setTp2(e.target.value)} />
        </label>
        <label className="text-xs space-y-1.5 block">
          <span className="text-muted-foreground">Take profit 3</span>
          <input className={input} inputMode="decimal" value={tp3} onChange={(e) => setTp3(e.target.value)} />
        </label>
      </div>

      <label className="text-xs space-y-1.5 block">
        <span className="text-muted-foreground">Note (optional)</span>
        <input className={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why you are taking this trade" />
      </label>

      <button
        onClick={() => submit.mutate()}
        disabled={submit.isPending}
        className="rounded-md bg-[color:var(--gold)] text-black px-4 py-2 text-sm font-medium disabled:opacity-60"
      >
        {submit.isPending ? "Placing…" : `Place manual ${direction.toLowerCase()} order`}
      </button>
    </div>
  );
}
