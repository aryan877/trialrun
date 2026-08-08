import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function ProductPageSkeleton({
  variant = "dashboard",
}: {
  readonly variant?: "dashboard" | "repository" | "review";
}) {
  const rows = variant === "review" ? 5 : variant === "repository" ? 4 : 3;
  return (
    <div aria-label="Loading page data" aria-live="polite" role="status">
      <div className="flex min-h-[98px] items-center justify-between gap-4 border-b border-border px-4 py-6">
        <div className="w-full max-w-xl space-y-2">
          <Skeleton className="h-3 w-28 rounded-[2px]" />
          <Skeleton className="h-8 w-3/5 rounded-[2px]" />
          <Skeleton className="h-4 w-4/5 rounded-[2px]" />
        </div>
        <Skeleton className="hidden h-9 w-32 rounded-[2px] sm:block" />
      </div>
      <div className="space-y-10 px-4 py-8">
        <div
          className={cn(
            "grid overflow-hidden rounded-[4px] border border-border",
            variant === "dashboard" ? "sm:grid-cols-3" : "lg:grid-cols-2",
          )}
        >
          {Array.from({ length: variant === "dashboard" ? 3 : 2 }, (_, index) => (
            <div
              className="space-y-3 border-b border-border p-4 last:border-b-0 sm:border-r sm:border-b-0"
              key={index}
            >
              <Skeleton className="h-3 w-24 rounded-[2px]" />
              <Skeleton className="h-8 w-20 rounded-[2px]" />
              <Skeleton className="h-4 w-2/3 rounded-[2px]" />
            </div>
          ))}
        </div>
        <div className="space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-7 w-48 rounded-[2px]" />
            <Skeleton className="h-4 w-3/5 rounded-[2px]" />
          </div>
          <div className="overflow-hidden rounded-[4px] border border-border">
            {Array.from({ length: rows }, (_, index) => (
              <div
                className="grid grid-cols-[minmax(0,1fr)_130px] gap-4 border-b border-border p-3 last:border-b-0"
                key={index}
              >
                <div className="space-y-2">
                  <Skeleton className="h-4 w-2/3 rounded-[2px]" />
                  <Skeleton className="h-3 w-1/3 rounded-[2px]" />
                </div>
                <Skeleton className="h-6 w-full rounded-[2px]" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <span className="sr-only">Loading real repository and review records.</span>
    </div>
  );
}
