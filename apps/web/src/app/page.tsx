import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { ConcordWorkflowSection } from "@/components/concord-workflow-section";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { dashboardPath } from "@/lib/dashboard-routes";

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-gradient-to-b from-background via-background to-muted/20">
      <header className="mx-auto max-w-5xl px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center border border-border bg-muted text-sm font-bold leading-none">
            ◇
          </div>
          <div>
            <div className="text-sm font-medium leading-tight">Concord</div>
            <div className="text-xs text-muted-foreground">Health reconciliation</div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 pb-16 pt-4">
        <section className="max-w-2xl">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Patient-owned · cross-provider
          </p>
          <h1 className="mt-3 text-3xl font-medium tracking-tight sm:text-4xl">
            One trustworthy picture of your health
          </h1>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            Your records live in silos — PCP, specialist, urgent care, pharmacy, labs. Each provider only
            ever saw their slice. Concord merges them into one grounded record, surfaces what no single
            doctor could catch, and protects you at the point of care.
          </p>
          <div className="mt-8">
            <Link href={dashboardPath("upload")} className={cn(buttonVariants())}>
              Get started
              <ArrowRight />
            </Link>
          </div>
        </section>

        <div className="my-14 h-px bg-border/60" />

        <ConcordWorkflowSection numbered />

        <section className="mt-14 rounded-lg border border-border/60 bg-muted/10 px-6 py-8">
          <h2 className="text-base font-medium">Ready to run the demo?</h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Upload the five synthetic records, reconcile, open Findings for the cross-provider hero catch,
            then Guardian + the simulated exam room for the live safety demo.
          </p>
          <Link
            href={dashboardPath("upload")}
            className={cn(buttonVariants({ variant: "secondary" }), "mt-5 inline-flex")}
          >
            Go to workspace
          </Link>
        </section>
      </main>
    </div>
  );
}
