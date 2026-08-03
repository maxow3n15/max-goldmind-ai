import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listHeartbeats } from "@/lib/heartbeat.functions";
import { cn } from "@/lib/utils";

/**
 * Durable liveness. The in-page diagnostics show what this tab believes;
 * this panel shows what the server last heard, which is the only thing
 * that can tell you the engine stopped reporting.
 */
export function HeartbeatPanel() {
  const fn = useServerFn(listHeartbeats);
  const q = useQuery({ queryKey: ["heartbeats"], queryFn: () => fn(), refetchInterval: 30_000 });
  const rows = q.data ?? [];

  return (
    <section className="glass-panel rounded-2xl p-5">
      <header className="flex items-baseline justify-between mb-4">
        <h2 className="font-display text-lg font-semibold">Engine heartbeats</h2>
        <span className="text-xs text-muted-foreground">server-recorded liveness</span>
      </header>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No engine has checked in yet. Heartbeats appear once the autopilot engine has been running.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((h) => {
            const tone = h.stale || h.status === "down" ? "danger" : h.status === "degraded" ? "warn" : "ok";
            return (
              <li key={h.engine} className="flex items-center justify-between rounded-xl bg-secondary/40 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      tone === "ok" && "bg-[color:var(--success)]",
                      tone === "warn" && "bg-[color:var(--warning,orange)]",
                      tone === "danger" && "bg-[color:var(--destructive)]",
                    )}
                  />
                  <span className="text-sm font-medium capitalize">{h.engine}</span>
                </div>
                <span className="font-mono text-xs text-muted-foreground">
                  {h.stale ? "no signal · " : ""}
                  {h.age_seconds < 90 ? `${h.age_seconds}s ago` : `${Math.round(h.age_seconds / 60)}m ago`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
