import Link from "next/link";
import { ArrowRight, Check, Info, OctagonAlert, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function formatTimestamp(value: Date | string | null | undefined): string {
  if (!value) return "Not recorded";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Invalid timestamp";
  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date)} UTC`;
}

export function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`;
  if (value < 1_073_741_824) return `${(value / 1_048_576).toFixed(1)} MB`;
  return `${(value / 1_073_741_824).toFixed(1)} GB`;
}

export function shortSha(value: string): string {
  return value.slice(0, 8);
}

export function TrialRunWordmark({ compact = false }: { readonly compact?: boolean }) {
  return (
    <span
      aria-label="TrialRun"
      className={cn(
        "inline-flex items-baseline font-semibold tracking-[-0.04em] text-foreground",
        compact ? "text-base" : "text-lg",
      )}
    >
      trial<span className="text-signal-running">/</span>run
    </span>
  );
}

type NoticeTone = "success" | "info" | "warning" | "error";

const noticeConfig = {
  success: {
    icon: Check,
    className: "border-signal-running/35 bg-signal-running/7 text-signal-running",
  },
  info: {
    icon: Info,
    className: "border-signal-info/35 bg-signal-info/7 text-signal-info",
  },
  warning: {
    icon: TriangleAlert,
    className: "border-signal-warning/35 bg-signal-warning/7 text-signal-warning",
  },
  error: {
    icon: OctagonAlert,
    className: "border-destructive/35 bg-destructive/7 text-destructive",
  },
} satisfies Record<NoticeTone, { readonly icon: typeof Info; readonly className: string }>;

export function Notice({
  tone,
  children,
}: {
  readonly tone: NoticeTone;
  readonly children: React.ReactNode;
}) {
  const config = noticeConfig[tone];
  const Icon = config.icon;
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-[4px] border px-3 py-2.5 text-sm leading-5",
        config.className,
      )}
      role={tone === "error" ? "alert" : "status"}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="text-foreground">{children}</div>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: React.ReactNode;
  readonly actions?: React.ReactNode;
}) {
  return (
    <header className="flex min-h-[98px] flex-col justify-center gap-4 border-b border-border px-4 py-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="mb-1 text-[11px] leading-4 font-semibold tracking-[0.1em] text-muted-foreground uppercase">
          {eyebrow}
        </p>
        <h1 className="text-2xl leading-8 font-medium tracking-[-0.035em] text-balance break-words sm:text-[30px] sm:leading-9">
          {title}
        </h1>
        <div className="mt-1.5 max-w-3xl text-sm leading-5 text-muted-foreground">
          {description}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function SectionHeading({
  title,
  description,
  action,
  id,
}: {
  readonly title: string;
  readonly description?: React.ReactNode;
  readonly action?: React.ReactNode;
  readonly id?: string;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="text-xl leading-7 font-medium tracking-[-0.025em]" id={id}>
          {title}
        </h2>
        {description ? (
          <div className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">
            {description}
          </div>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  href,
  actionLabel,
}: {
  readonly title: string;
  readonly description: React.ReactNode;
  readonly href?: string | undefined;
  readonly actionLabel?: string | undefined;
}) {
  return (
    <div className="flex min-h-48 flex-col items-start justify-center rounded-[4px] border border-dashed border-border px-4 py-8 sm:px-6">
      <p className="text-base leading-6 font-medium">{title}</p>
      <div className="mt-1 max-w-xl text-sm leading-5 text-muted-foreground">{description}</div>
      {href && actionLabel ? (
        <Button asChild className="mt-4 h-9 rounded-[2px] px-4" size="lg">
          <Link href={href} prefetch={false}>
            {actionLabel}
            <ArrowRight aria-hidden="true" data-icon="inline-end" />
          </Link>
        </Button>
      ) : null}
    </div>
  );
}

export function Definition({
  term,
  children,
  mono = false,
}: {
  readonly term: string;
  readonly children: React.ReactNode;
  readonly mono?: boolean;
}) {
  return (
    <div className="min-w-0 border-b border-border py-3 last:border-b-0">
      <dt className="text-[10px] leading-4 font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {term}
      </dt>
      <dd className={cn("mt-1 break-words text-sm leading-5", mono && "font-mono text-xs")}>
        {children}
      </dd>
    </div>
  );
}

export function Sha({ value }: { readonly value: string }) {
  return (
    <code
      className="rounded-[2px] border border-border bg-white/[0.025] px-1.5 py-0.5 font-mono text-xs text-foreground"
      title={value}
    >
      {shortSha(value)}
    </code>
  );
}
