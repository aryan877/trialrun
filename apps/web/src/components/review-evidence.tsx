import { ExternalLink, FileCode2, FileImage, FileText, Film, ShieldCheck } from "lucide-react";

import type { Artifact } from "@trialrun/db";

import { EmptyState, formatBytes, formatTimestamp } from "@/components/product-ui";
import type { BrowserRecordingPair, ScreenshotPair } from "@/components/review-evidence-pairing";
import { cn } from "@/lib/utils";

function RecordingUnavailable({
  side,
  evidenceSealed,
}: {
  readonly side: "base" | "head";
  readonly evidenceSealed: boolean;
}) {
  const sideLabel = side === "head" ? "pull request" : "base";
  return (
    <div
      className="flex min-h-60 flex-col justify-center bg-black/15 px-4 py-8 sm:px-5"
      role="status"
    >
      <Film aria-hidden="true" className="size-6 text-muted-foreground" strokeWidth={1.5} />
      <p className="mt-4 text-sm font-medium">
        {evidenceSealed
          ? `${sideLabel} recording withheld or unavailable`
          : `${sideLabel} recording is not ready`}
      </p>
      <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
        {evidenceSealed
          ? `The sealed review did not persist a playable WebM file for the ${sideLabel} side. TrialRun withholds recordings that could contain test secrets; capture or artifact limits can also leave a side unavailable.`
          : `A ${sideLabel} recording can appear after the live browser session is sealed and copied to persistent storage.`}
      </p>
    </div>
  );
}

function BrowserRecording({
  artifact,
  side,
  evidenceSealed,
}: {
  readonly artifact: Artifact | undefined;
  readonly side: "base" | "head";
  readonly evidenceSealed: boolean;
}) {
  if (!artifact) {
    return <RecordingUnavailable evidenceSealed={evidenceSealed} side={side} />;
  }

  const sideLabel = side === "head" ? "Pull request" : "Base";
  const headingId = `browser-recording-${artifact.id}`;
  const source = `/api/artifacts/${artifact.id}`;
  const playable = artifact.mediaType.toLocaleLowerCase("en-US") === "video/webm";

  return (
    <article className="min-w-0 bg-black/15">
      <div className="flex min-h-11 items-center justify-between gap-3 border-b border-border px-3">
        <div>
          <h3 className="text-xs font-semibold" id={headingId}>
            {sideLabel} recording
          </h3>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {side === "head" ? "Primary behavior proof" : "Matched baseline"}
          </p>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {formatBytes(artifact.sizeBytes)}
        </span>
      </div>
      {playable ? (
        <video
          aria-labelledby={headingId}
          className="aspect-video w-full bg-black object-contain"
          controls
          playsInline
          preload="metadata"
        >
          <source src={source} type="video/webm" />
          Your browser cannot play this WebM recording. You can{" "}
          <a className="underline" href={source}>
            open the persisted file
          </a>
          .
        </video>
      ) : (
        <div
          className="flex aspect-video items-center px-4 py-8 text-sm leading-5 text-muted-foreground"
          role="status"
        >
          This persisted browser recording has media type {artifact.mediaType}, so TrialRun will not
          present it as WebM video.
        </div>
      )}
      <div className="grid gap-3 border-t border-border px-3 py-3 text-[10px] leading-4 text-muted-foreground sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <p className="text-foreground">Persisted once</p>
          <p className="truncate font-mono" title={artifact.sha256}>
            SHA-256 {artifact.sha256}
          </p>
        </div>
        <div className="sm:text-right">
          <p className="text-foreground">Stored {formatTimestamp(artifact.createdAt)}</p>
          <a
            className="inline-flex items-center gap-1 hover:text-signal-info focus-visible:rounded-[2px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            href={source}
            rel="noreferrer"
            target="_blank"
          >
            Open original
            <ExternalLink aria-hidden="true" className="size-3" />
          </a>
        </div>
      </div>
    </article>
  );
}

export function BrowserRecordingEvidence({
  pairs,
  evidenceSealed,
}: {
  readonly pairs: readonly BrowserRecordingPair[];
  readonly evidenceSealed: boolean;
}) {
  if (pairs.length === 0) {
    return (
      <EmptyState
        description={
          evidenceSealed
            ? "The sealed review did not persist either WebM recording. TrialRun withholds video when test secrets could be visible; a capture or artifact limit can also leave recordings unavailable. Screenshots, logs, findings, and teardown proof remain available below."
            : "Native WebM players appear here only after the live browser session is sealed and its owner-scoped artifacts reach persistent storage."
        }
        title={
          evidenceSealed
            ? "Browser recordings withheld or unavailable"
            : "Browser recordings are not ready"
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      {pairs.map((pair) => (
        <figure className="overflow-hidden rounded-[4px] border border-border" key={pair.name}>
          <figcaption className="border-b border-border bg-white/[0.025] px-3 py-2 text-xs font-medium">
            Browser session: <span className="font-mono text-signal-info">{pair.name}</span>
          </figcaption>
          <div className="grid divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0">
            <BrowserRecording artifact={pair.head} evidenceSealed={evidenceSealed} side="head" />
            <BrowserRecording artifact={pair.base} evidenceSealed={evidenceSealed} side="base" />
          </div>
        </figure>
      ))}
    </div>
  );
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
    case "browser_recording":
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
