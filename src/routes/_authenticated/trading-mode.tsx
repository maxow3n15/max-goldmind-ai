import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ToggleRight, ShieldCheck, AlertTriangle, FlaskConical, Radio } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { getUserSettings, setTradingMode } from "@/lib/settings.functions";
import { listBrokerConnections } from "@/lib/brokers.functions";
import { brokerSpec, maskAccountNumber } from "@/lib/brokers/catalog";

export const Route = createFileRoute("/_authenticated/trading-mode")({
  component: TradingModePage,
  head: () => ({
    meta: [
      { title: "Trading Mode · GoldMind AI" },
      { name: "description", content: "Switch GoldMind AI between simulated paper trading and live execution on your connected broker." },
      { property: "og:title", content: "Trading Mode · GoldMind AI" },
      { property: "og:description", content: "Paper or live — choose how the GoldMind AI engine executes XAUUSD trades." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

function TradingModePage() {
  const qc = useQueryClient();
  const settingsFn = useServerFn(getUserSettings);
  const modeFn = useServerFn(setTradingMode);
  const brokersFn = useServerFn(listBrokerConnections);

  const settings = useQuery({ queryKey: ["settings"], queryFn: () => settingsFn() });
  const brokers = useQuery({ queryKey: ["broker-connections"], queryFn: () => brokersFn() });

  const rows: any[] = Array.isArray(brokers.data) ? brokers.data : [];
  const active = rows.find((r) => r.is_default) ?? null;
  const mode = ((settings.data as any)?.trading_mode ?? "paper") as "paper" | "live";

  const change = useMutation({
    mutationFn: (next: "paper" | "live") => modeFn({ data: { trading_mode: next } }),
    onSuccess: (res: any, next) => {
      if (res?.ok) toast.success(next === "live" ? "Live execution enabled" : "Switched to paper trading");
      else toast.error(res?.reason ?? "Could not change trading mode");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not change trading mode"),
  });

  const liveReady = !!active && active.status === "connected";

  return (
    <div className="p-5 md:p-8 space-y-6 max-w-4xl">
      <header>
        <h1 className="font-display text-2xl font-semibold flex items-center gap-2">
          <ToggleRight className="h-5 w-5 text-[color:var(--gold)]" /> Trading Mode
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Paper and live run the identical AI, risk and analytics stack. Only the execution destination changes.
        </p>
      </header>

      <div
        className={`glass-panel rounded-xl p-4 flex items-center gap-3 border ${
          mode === "live" ? "border-red-500/40" : "border-emerald-500/30"
        }`}
      >
        <Radio className={`h-4 w-4 ${mode === "live" ? "text-red-400" : "text-emerald-400"}`} />
        <div className="text-sm">
          Currently executing in{" "}
          <span className={mode === "live" ? "text-red-400 font-semibold" : "text-emerald-400 font-semibold"}>
            {mode === "live" ? "LIVE" : "PAPER"}
          </span>{" "}
          mode
          {mode === "live" && active ? ` · ${brokerSpec(active.broker_id)?.name ?? active.broker_id} ${maskAccountNumber(active.account_number)}` : ""}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <button
          onClick={() => change.mutate("paper")}
          disabled={change.isPending}
          className={`text-left glass-panel rounded-xl p-5 border transition-colors ${
            mode === "paper" ? "border-[color:var(--gold)]" : "border-border hover:bg-accent"
          }`}
        >
          <div className="flex items-center gap-2 font-medium">
            <FlaskConical className="h-4 w-4 text-emerald-400" /> Paper Trading
          </div>
          <ul className="mt-3 space-y-1.5 text-xs text-muted-foreground">
            <li>• Simulates every trade against live gold prices</li>
            <li>• Maintains a virtual balance and equity curve</li>
            <li>• Full performance statistics and analytics</li>
            <li>• No broker connection required</li>
          </ul>
        </button>

        <button
          onClick={() => change.mutate("live")}
          disabled={change.isPending || !liveReady}
          className={`text-left glass-panel rounded-xl p-5 border transition-colors disabled:opacity-60 ${
            mode === "live" ? "border-red-500/60" : "border-border hover:bg-accent"
          }`}
        >
          <div className="flex items-center gap-2 font-medium">
            <Radio className="h-4 w-4 text-red-400" /> Live Trading
          </div>
          <ul className="mt-3 space-y-1.5 text-xs text-muted-foreground">
            <li>• Orders are sent straight to your connected broker</li>
            <li>• Requires an active default execution account</li>
            <li>• Server-side safety checks run before every order</li>
            <li>• Real capital is at risk</li>
          </ul>
        </button>
      </div>

      <div className="glass-panel rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-medium">Execution account</h2>
        {active ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Broker</div>
              {brokerSpec(active.broker_id)?.name ?? active.broker_id}
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Account</div>
              {maskAccountNumber(active.account_number)}
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Type</div>
              <span className={active.account_type === "live" ? "text-red-400" : "text-emerald-400"}>
                {String(active.account_type).toUpperCase()}
              </span>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</div>
              {active.status}
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2 text-xs text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5" />
            <span>
              No default execution account.{" "}
              <Link to="/broker-connections" className="underline">Connect a broker</Link> to unlock live trading.
            </span>
          </div>
        )}
      </div>

      <div className="glass-panel rounded-xl p-4 flex items-start gap-3">
        <ShieldCheck className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Before any live order GoldMind AI verifies the broker connection, market hours, available margin, spread,
          stop-loss and take-profit distances, position size and broker order rules. If a check fails the order is
          cancelled and the reason is shown in the Autopilot log.
        </p>
      </div>
    </div>
  );
}
