"use client";

import Link from "next/link";
import { OctagonAlert, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function WorkspaceError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  return (
    <section className="flex min-h-[55dvh] items-center justify-center px-4 py-12">
      <div className="panel-surface w-full max-w-xl p-5 sm:p-6" role="alert">
        <OctagonAlert aria-hidden="true" className="size-7 text-destructive" />
        <p className="mt-5 font-mono text-[10px] tracking-[0.08em] text-destructive uppercase">
          Data request failed
        </p>
        <h1 className="mt-2 text-2xl leading-8 font-medium tracking-[-0.035em]">
          TrialRun could not render this workspace page.
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          No mutation was attempted by this error state. Retry the server render or return to the
          workspace.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-[10px] text-muted-foreground">
            Reference {error.digest}
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-2">
          <Button className="h-9 rounded-[2px]" onClick={reset} type="button">
            <RotateCcw aria-hidden="true" data-icon="inline-start" />
            Retry
          </Button>
          <Button asChild className="h-9 rounded-[2px]" variant="outline">
            <Link href="/app">Return to workspace</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
