import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FlaskConical, Lock } from "lucide-react";
import { getUserSettings, setDemoConfidenceFloor } from "@/lib/settings.functions";
import { DEMO_FLOOR_MIN } from "@/lib/services/confidence-floor";
import { CONFIDENCE_GATES } from "@/lib/services/scoring";

/** Demo/paper forward-test confidence floor. Real-money live stays at 88%. */
export function DemoFloorPanel() {
  const getFn = useServerFn(getUserSettings);
  const setFn = useServerFn(setDemoConfidenceFloor);
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["user-settings"], queryFn: () => getFn() });
  const saved = (settings.data as any)?.demo_confidence_floor as number | null | undefined;
  const [value, setValue] = useState<number>(CONFIDENCE_GATES.FINAL);

  useEffect(() => {
    if (saved != null) setValue(saved);
  }, [saved]);

  const save = useMutation({
    mutationFn: (v: number | null) => setFn({ data: { demo_confidence_floor: v } }),
    onSuccess: (_r, v) => {
      toast.success(v == null ? "Demo floor reset to 88%" : `Demo floor set to ${v}%`);
      qc.invalidateQueries({ queryKey: ["user-settings"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not save"),
  });

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex items-center gap-2">
        <FlaskConical className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Demo confidence floor</h3>
        <span className="ml-auto text-xs text-muted-foreground">
          Active: {saved ?? CONFIDENCE_GATES.FINAL}%
        </span>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Applies only to paper trading and verified demo/practice accounts, for forward testing.
      </p>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={DEMO_FLOOR_MIN}
          max={CONFIDENCE_GATES.FINAL}
          step={1}
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
          className="flex-1 accent-primary"
          aria-label="Demo confidence floor"
        />
        <span className="w-12 text-right font-mono text-sm">{value}%</span>
        <button
          className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
          disabled={save.isPending}
          onClick={() => save.mutate(value)}
        >
          Save
        </button>
        <button
          className="rounded-md border border-border px-3 py-1 text-xs disabled:opacity-50"
          disabled={save.isPending}
          onClick={() => save.mutate(null)}
        >
          Reset
        </button>
      </div>
      <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
        <Lock className="h-3 w-3" /> Real-money live trading is locked at {CONFIDENCE_GATES.FINAL}%.
      </p>
    </div>
  );
}
