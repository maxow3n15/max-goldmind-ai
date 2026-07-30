import { Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export type LoadingStage =
  | "Checking Authentication…"
  | "Connecting Market…"
  | "Connecting AI…"
  | "Loading Trading Engine…"
  | "Loading Dashboard…";

export function PlatformLoading({ stage = "Loading Dashboard…" }: { stage?: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-background px-6 animate-in fade-in duration-300">
      <div className="flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-[color:var(--gold)]" />
        <span className="font-display text-sm tracking-wide">{stage}</span>
      </div>
      <div className="w-full max-w-3xl grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
      </div>
      <Skeleton className="w-full max-w-3xl h-48 rounded-xl" />
    </div>
  );
}

/** Inline skeleton for panels inside an already-rendered shell. */
export function PanelSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="glass-panel rounded-xl p-4 space-y-2">
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
    </div>
  );
}
