import type { LucideIcon } from "lucide-react";
import {
  Ban,
  Box,
  Check,
  CircleDashed,
  Columns2,
  Hammer,
  ListChecks,
  OctagonAlert,
  Play,
  Send,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import type { ReviewStatus, ReviewVerdict } from "@trialrun/domain";

import { cn } from "@/lib/utils";

type Tone = "neutral" | "running" | "info" | "warning" | "failure" | "success";

const toneClasses: Record<Tone, string> = {
  neutral: "border-white/10 bg-white/[0.03] text-muted-foreground",
  running: "border-signal-running/35 bg-signal-running/8 text-signal-running",
  info: "border-signal-info/35 bg-signal-info/8 text-signal-info",
  warning: "border-signal-warning/35 bg-signal-warning/8 text-signal-warning",
  failure: "border-destructive/35 bg-destructive/8 text-destructive",
  success: "border-signal-running/35 bg-signal-running/8 text-signal-running",
};

export function StateBadge({
  children,
  tone = "neutral",
  icon: Icon,
  className,
}: {
  readonly children: React.ReactNode;
  readonly tone?: Tone;
  readonly icon?: LucideIcon;
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 w-fit items-center gap-1.5 rounded-[2px] border px-2 text-[11px] font-semibold tracking-[0.06em] uppercase",
        toneClasses[tone],
        className,
      )}
    >
      {Icon ? <Icon aria-hidden="true" className="size-3" strokeWidth={2} /> : null}
      {children}
    </span>
  );
}

const statusConfig: Record<
  ReviewStatus,
  { readonly label: string; readonly tone: Tone; readonly icon: LucideIcon }
> = {
  queued: { label: "Queued", tone: "neutral", icon: CircleDashed },
  provisioning: { label: "Provisioning", tone: "info", icon: Box },
  building: { label: "Building", tone: "info", icon: Hammer },
  planning: { label: "Planning", tone: "info", icon: ListChecks },
  running: { label: "Running", tone: "running", icon: Play },
  comparing: { label: "Comparing", tone: "running", icon: Columns2 },
  publishing: { label: "Publishing", tone: "info", icon: Send },
  tearing_down: { label: "Tearing down", tone: "warning", icon: Trash2 },
  completed: { label: "Complete", tone: "success", icon: Check },
  inconclusive: { label: "Inconclusive", tone: "warning", icon: OctagonAlert },
  cancelled: { label: "Cancelled", tone: "neutral", icon: Ban },
};

const verdictConfig: Record<
  ReviewVerdict,
  { readonly label: string; readonly tone: Tone; readonly icon: LucideIcon }
> = {
  pass: { label: "Pass", tone: "success", icon: ShieldCheck },
  fail: { label: "Fail", tone: "failure", icon: OctagonAlert },
  inconclusive: { label: "Inconclusive", tone: "warning", icon: OctagonAlert },
};

export function ReviewStatusBadge({
  status,
  verdict,
}: {
  readonly status: ReviewStatus;
  readonly verdict?: ReviewVerdict | null;
}) {
  const config =
    verdict && ["completed", "inconclusive"].includes(status)
      ? verdictConfig[verdict]
      : statusConfig[status];
  return (
    <StateBadge icon={config.icon} tone={config.tone}>
      {config.label}
    </StateBadge>
  );
}

const reviewPhases: readonly ReviewStatus[] = [
  "queued",
  "provisioning",
  "building",
  "planning",
  "running",
  "comparing",
  "publishing",
  "tearing_down",
  "completed",
];

export function ReviewPhaseRail({ status }: { readonly status: ReviewStatus }) {
  const terminalInterruption = status === "inconclusive" || status === "cancelled";
  const activeIndex = reviewPhases.indexOf(status);

  return (
    <ol
      aria-label="Review lifecycle"
      className="grid min-w-[760px] grid-cols-9 overflow-hidden rounded-[4px] border border-border bg-black/10"
    >
      {reviewPhases.map((phase, index) => {
        const config = statusConfig[phase];
        const complete = !terminalInterruption && activeIndex > index;
        const active = !terminalInterruption && activeIndex === index;
        return (
          <li
            aria-current={active ? "step" : undefined}
            className={cn(
              "flex min-h-14 items-center gap-2 border-r border-border px-2.5 py-2 last:border-r-0",
              complete && "bg-white/[0.025] text-foreground",
              active && "bg-signal-running/8 text-signal-running",
              !complete && !active && "text-muted-foreground",
            )}
            key={phase}
          >
            {complete ? (
              <Check aria-hidden="true" className="size-3.5 shrink-0" />
            ) : (
              <config.icon aria-hidden="true" className="size-3.5 shrink-0" />
            )}
            <span className="text-[10px] leading-4 font-semibold tracking-[0.04em] uppercase">
              {config.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
