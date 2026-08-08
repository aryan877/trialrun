import type { Artifact } from "@trialrun/db";

export interface ScreenshotPair {
  readonly name: string;
  readonly base?: Artifact;
  readonly head?: Artifact;
}

export interface BrowserRecordingPair {
  readonly name: string;
  readonly base?: Artifact;
  readonly head?: Artifact;
}

function pairSidedArtifacts(
  artifacts: readonly Artifact[],
  kind: "browser_recording" | "screenshot",
): readonly ScreenshotPair[] {
  const pairs = new Map<string, { base?: Artifact; head?: Artifact }>();
  for (const artifact of artifacts) {
    if (artifact.kind !== kind || artifact.side === "review") continue;
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

export function pairScreenshotArtifacts(artifacts: readonly Artifact[]): readonly ScreenshotPair[] {
  return pairSidedArtifacts(artifacts, "screenshot");
}

export function pairBrowserRecordingArtifacts(
  artifacts: readonly Artifact[],
): readonly BrowserRecordingPair[] {
  return pairSidedArtifacts(artifacts, "browser_recording");
}
