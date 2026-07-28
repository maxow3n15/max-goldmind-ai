import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "gold" | "success" | "danger" | "warning";
  icon?: ReactNode;
}

export function StatCard({ label, value, hint, tone = "default", icon }: Props) {
  const toneClasses = {
    default: "text-foreground",
    gold: "gold-text",
    success: "text-[color:var(--success)]",
    danger: "text-[color:var(--destructive)]",
    warning: "text-[color:var(--warning)]",
  };
  return (
    <div className="glass-panel rounded-xl p-4 flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-medium">{label}</span>
        {icon && <span className="text-muted-foreground opacity-70">{icon}</span>}
      </div>
      <div className={cn("font-display text-2xl font-semibold font-mono tabular-nums", toneClasses[tone])}>{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
