import Link from "next/link";
import { ArrowLeft, SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function ProductNotFound() {
  return (
    <section className="flex min-h-[55dvh] items-center justify-center px-4 py-12">
      <div className="panel-surface w-full max-w-xl p-5 sm:p-6">
        <SearchX aria-hidden="true" className="size-7 text-muted-foreground" />
        <p className="mt-5 font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
          Resource unavailable
        </p>
        <h1 className="mt-2 text-2xl leading-8 font-medium tracking-[-0.035em]">
          This record does not exist in your workspace.
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          It may have been removed, disconnected, or belong to a different TrialRun account.
        </p>
        <Button asChild className="mt-6 h-9 rounded-[2px]" variant="outline">
          <Link href="/app">
            <ArrowLeft aria-hidden="true" data-icon="inline-start" />
            Return to workspace
          </Link>
        </Button>
      </div>
    </section>
  );
}
