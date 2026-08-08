import { ExternalLink, FileCode2, FileImage, FileText, Film, ShieldCheck } from "lucide-react";

import type { Artifact } from "@trialrun/db";

import { EmptyState, formatBytes, formatTimestamp } from "@/components/product-ui";
import { cn } from "@/lib/utils";

export interface ScreenshotPair {
  readonly name: string;
  readonly base?: Artifact;
  readonly head?: Artifact;
}

export function pairScreenshotArtifacts(artifacts: readonly Artifact[]): readonly ScreenshotPair[] {
  const pairs = new Map<string, { base?: Artifact; head?: Artifact }>();
  for (const artifact of artifacts) {
    if (artifact.kind !== "screenshot" || artifact.side === "review") continue;
    const prefix = `${artifact.side}-`;
    const name = artifact.label.startsWith(prefix)
      ? artifact.label.slice(prefix.length)
      : artifact.label;
    const pair = pairs.get(name) ?? {};
    pair[artifact.side] = artifact;
    pairs.set(name, pair);
  }
  return [...pairs.entries()].map(([name, pair]) => ({ name, ...pair }));
}

function ArtifactCapture({
  artifact,
  side,
}: {
  readonly artifact: Artifact | undefined;
  readonly side: "base" | "head";
}) {
  return (
    <div className="min-w-0 bg-black/15">
      <div className="flex h-9 items-center justify-between border-b border-border px-3">
        <span className="text-[11px] font-semibold tracking-[0.08em] uppercase">
          {side === "base" ? "Base" : "Pull request"}
        </span>
        {artifact ? (
          <span className="font-mono text-[10px] text-muted-foreground">
            {formatBytes(artifact.sizeBytes)}
          </span>
        ) : null}
      </div>
      {artifact ? (
        <div className="flex min-h-44 flex-col justify-between p-4">
          <div>
            <FileImage aria-hidden="true" className="size-7 text-signal-info" strokeWidth={1.5} />
            <p className="mt-4 text-sm font-medium">{artifact.label}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Open the exact owner-scoped capture persisted for this side of the review.
            </p>
            <a
              className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-[2px] border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:border-signal-info/50 hover:text-signal-info focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              href={`/api/artifacts/${artifact.id}`}
              rel="noreferrer"
              target="_blank"
            >
              Open capture
              <ExternalLink aria-hidden="true" className="size-3.5" />
            </a>
          </div>
          <dl className="mt-5 grid gap-2 text-[10px] leading-4 text-muted-foreground sm:grid-cols-2">
            <div>
              <dt className="uppercase">SHA-256</dt>
              <dd className="truncate font-mono text-foreground" title={artifact.sha256}>
                {artifact.sha256.slice(0, 16)}
              </dd>
            </div>
            <div>
              <dt className="uppercase">Recorded</dt>
              <dd className="text-foreground">{formatTimestamp(artifact.createdAt)}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <div
          className="flex min-h-44 items-center px-4 py-8 text-sm leading-5 text-muted-foreground"
          role="status"
        >
          No {side === "base" ? "base" : "pull request"} capture was persisted for this checkpoint.
        </div>
      )}
    </div>
  );
}

export function MatchedEvidence({ pairs }: { readonly pairs: readonly ScreenshotPair[] }) {
  if (pairs.length === 0) {
    return (
      <EmptyState
        description="This review has no persisted screenshot checkpoints. Event, finding, artifact, and teardown records remain listed below."
        title="No matched visual captures"
      />
    );
  }

  return (
    <div className="space-y-3">
      {pairs.map((pair) => (
        <figure className="overflow-hidden rounded-[4px] border border-border" key={pair.name}>
          <figcaption className="border-b border-border bg-white/[0.025] px-3 py-2 text-xs font-medium">
            Checkpoint: <span className="font-mono text-signal-info">{pair.name}</span>
          </figcaption>
          <div className="grid divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0">
            <ArtifactCapture artifact={pair.base} side="base" />
            <ArtifactCapture artifact={pair.head} side="head" />
          </div>
        </figure>
      ))}
    </div>
  );
}

function artifactIcon(kind: string) {
  switch (kind) {
    case "screenshot":
      return FileImage;
    case "video":
      return Film;
    case "trace":
      return FileCode2;
    case "result":
      return ShieldCheck;
    case "observations":
    case "application_log":
    default:
      return FileText;
  }
}

export function ArtifactLedger({ artifacts }: { readonly artifacts: readonly Artifact[] }) {
  if (artifacts.length === 0) {
    return (
      <EmptyState
        description="Artifact rows appear only after evidence has been copied to persistent storage."
        title="No artifacts persisted yet"
      />
    );
  }

  return (
    <ul className="overflow-hidden rounded-[4px] border border-border">
      {artifacts.map((artifact) => {
        const Icon = artifactIcon(artifact.kind);
        return (
          <li
            className="grid gap-3 border-b border-border px-3 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_100px_110px_180px] sm:items-center"
            key={artifact.id}
          >
            <div className="flex min-w-0 items-start gap-2.5">
              <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <a
                  className="inline-flex max-w-full items-center gap-1.5 text-sm font-medium hover:text-signal-info focus-visible:rounded-[2px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  href={`/api/artifacts/${artifact.id}`}
                  rel="noreferrer"
                  target="_blank"
                >
                  <span className="truncate">{artifact.label}</span>
                  <ExternalLink aria-hidden="true" className="size-3 shrink-0" />
                </a>
                <p
                  className="truncate font-mono text-[10px] leading-4 text-muted-foreground"
                  title={artifact.storageKey}
                >
                  {artifact.storageKey}
                </p>
              </div>
            </div>
            <span className="text-xs text-muted-foreground capitalize">{artifact.side}</span>
            <span className="text-xs text-muted-foreground">{formatBytes(artifact.sizeBytes)}</span>
            <code
              className={cn("truncate font-mono text-[10px] text-muted-foreground")}
              title={artifact.sha256}
            >
              {artifact.sha256}
            </code>
          </li>
        );
      })}
    </ul>
  );
}
