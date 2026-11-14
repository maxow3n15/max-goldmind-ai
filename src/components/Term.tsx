import { useState, type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { termDefinition } from "@/lib/glossary";

export function Term({ label, children }: { label: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const definition = termDefinition(label);
  if (!definition) return <>{children ?? label}</>;
  return <TooltipProvider delayDuration={200}><Tooltip open={open} onOpenChange={setOpen}>
    <TooltipTrigger asChild>
      <span tabIndex={0} role="button" aria-label={`Explain ${label}`} aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setOpen((value) => !value); } }}
        className="cursor-help border-b border-dotted border-gold/60 focus-visible:outline-2 focus-visible:outline-ring">
        {children ?? label}
      </span>
    </TooltipTrigger>
    <TooltipContent className="max-w-[min(290px,85vw)] text-xs leading-relaxed">{definition}</TooltipContent>
  </Tooltip></TooltipProvider>;
}