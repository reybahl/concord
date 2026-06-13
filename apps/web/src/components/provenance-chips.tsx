"use client";

import { useState } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Provenance } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ProvenanceChips({
  provenance,
  className,
}: {
  provenance: Provenance[];
  className?: string;
}) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (provenance.length === 0) {
    return (
      <span className={cn("text-[10px] text-amber-300/80", className)}>No source quote</span>
    );
  }

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex flex-wrap gap-1">
        {provenance.map((p, idx) => (
          <Tooltip key={`${p.sourceDocId}-${idx}`}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-expanded={expandedIdx === idx}
                  aria-label={`Source: ${p.sourceLabel}. ${expandedIdx === idx ? "Hide" : "Show"} quote.`}
                  onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
                  className={cn(
                    "cursor-help border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground transition hover:bg-muted/80 hover:text-foreground",
                    expandedIdx === idx && "border-foreground/30 bg-foreground/10 text-foreground",
                  )}
                >
                  {p.sourceLabel}
                </button>
              }
            />
            <TooltipContent
              side="top"
              align="start"
              className="max-w-md px-3 py-2 text-left leading-relaxed whitespace-pre-wrap"
            >
              <span className="block text-[10px] uppercase tracking-wide opacity-70">
                {p.sourceLabel}
              </span>
              <span className="mt-1 block font-mono text-[11px]">&ldquo;{p.textSpan}&rdquo;</span>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      {expandedIdx != null && (
        <blockquote className="border-l-2 border-foreground/20 bg-muted/30 px-2 py-1.5 text-[11px] leading-relaxed">
          <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
            {provenance[expandedIdx].sourceLabel}
          </span>
          <span className="mt-0.5 block font-mono text-foreground/90">
            &ldquo;{provenance[expandedIdx].textSpan}&rdquo;
          </span>
        </blockquote>
      )}
    </div>
  );
}
