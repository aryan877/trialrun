import type { LiveBrowserEvidence } from "./live-browser";

export interface CapturedLiveArtifactManifest {
  readonly artifactId: string;
  readonly digest: string;
  readonly byteSize: number;
  readonly mediaType: "image/png" | "video/webm";
}

export interface LiveEvidenceAgentHandoff {
  readonly availableEvidenceIds: readonly string[];
}

export function findCapturedLiveArtifact(
  evidence: Pick<LiveBrowserEvidence, "checkpoints" | "recordings">,
  artifactId: string,
): CapturedLiveArtifactManifest {
  const artifact =
    evidence.checkpoints.find((candidate) => candidate.artifactId === artifactId) ??
    evidence.recordings.find((candidate) => candidate.artifactId === artifactId);

  if (
    !artifact?.captured ||
    artifact.digest === undefined ||
    artifact.byteSize === undefined ||
    artifact.mediaType === undefined
  ) {
    throw new Error("Live artifact is not present in the sealed evidence manifest.");
  }

  return {
    artifactId,
    digest: artifact.digest,
    byteSize: artifact.byteSize,
    mediaType: artifact.mediaType,
  };
}

export function liveEvidenceAgentHandoff(evidence: LiveBrowserEvidence): LiveEvidenceAgentHandoff {
  const availableEvidenceIds = [
    ...evidence.ledger.map(({ id }) => id),
    ...evidence.observations.map(({ id }) => id),
    ...evidence.assertions.map(({ id }) => id),
    ...evidence.apiResponses.map(({ id }) => id),
    ...evidence.checkpoints.flatMap(({ captured, artifactId }) =>
      captured && artifactId ? [artifactId] : [],
    ),
    ...evidence.recordings.flatMap(({ captured, artifactId }) =>
      captured && artifactId ? [artifactId] : [],
    ),
    ...evidence.events.map(({ id }) => id),
  ].slice(0, 250);

  return { availableEvidenceIds };
}
