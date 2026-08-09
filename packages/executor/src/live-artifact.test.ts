import { describe, expect, it } from "vitest";

import { findCapturedLiveArtifact, liveEvidenceAgentHandoff } from "./live-artifact";
import { liveBrowserEvidenceSchema } from "./live-protocol";

const screenshotId = `artifact:${"a".repeat(64)}`;
const recordingId = `artifact:${"b".repeat(64)}`;
const timestamp = "2026-08-09T03:00:00.000Z";

const artifactEvidence = {
  checkpoints: [
    {
      artifactId: screenshotId,
      name: "checkout",
      side: "base" as const,
      stateVersion: 1,
      path: "/checkout",
      captured: true,
      digest: "c".repeat(64),
      byteSize: 1_024,
      mediaType: "image/png" as const,
      createdAt: timestamp,
    },
  ],
  recordings: [
    {
      artifactId: recordingId,
      side: "head" as const,
      captured: true,
      digest: "d".repeat(64),
      byteSize: 4_159_645,
      mediaType: "video/webm" as const,
      createdAt: timestamp,
    },
  ],
};

function evidence() {
  return liveBrowserEvidenceSchema.parse({
    status: {
      state: "finished",
      actionsUsed: 1,
      actionsRemaining: 199,
      checkpointsRemaining: 11,
      resetsRemaining: 4,
      expiresAt: "2026-08-09T04:00:00.000Z",
      stateVersions: { base: 1, head: 1 },
    },
    ledger: [
      {
        id: "ledger:finish",
        sequence: 1,
        tool: "finish_review",
        input: {},
        startedAt: timestamp,
        completedAt: "2026-08-09T03:00:00.001Z",
        outcome: "success",
        result: "session sealed",
      },
    ],
    observations: [
      {
        id: "observation:checkout",
        side: "head",
        path: "/checkout",
        title: "Checkout",
        snapshotTruncated: false,
        viewport: { width: 1_440, height: 900 },
        stateVersion: 1,
        observedAt: timestamp,
      },
    ],
    assertions: [
      {
        id: "assert:wrong-line",
        name: "wrong-line",
        sequence: 1,
        side: "head",
        stateVersion: 1,
        path: "/checkout",
        kind: "text",
        locatorFingerprint: "e".repeat(64),
        passed: false,
        expected: "$36.00",
        actual: "$24.00",
        createdAt: timestamp,
      },
    ],
    matchedAssertionNames: [],
    apiResponses: [
      {
        id: `response:${"f".repeat(64)}`,
        name: "quote",
        sequence: 1,
        side: "head",
        stateVersion: 1,
        method: "GET",
        path: "/api/quote",
        requestFingerprint: "1".repeat(64),
        status: 200,
        contentType: "application/json",
        bodySha256: "2".repeat(64),
        bodyPreview: '{"totalCents":7050}',
        bodyTruncated: false,
        capturedByteSize: 19,
        createdAt: timestamp,
      },
    ],
    checkpoints: artifactEvidence.checkpoints,
    matchedCheckpointNames: [],
    recordings: [
      {
        artifactId: recordingId,
        side: "base",
        captured: true,
        digest: "d".repeat(64),
        byteSize: 4_159_645,
        mediaType: "video/webm",
        createdAt: timestamp,
      },
      {
        side: "head",
        captured: false,
        createdAt: "2026-08-09T03:00:00.001Z",
      },
    ],
    events: [],
  });
}

describe("sealed live artifact lookup", () => {
  it("returns screenshot and real WebM manifests through the same verified path", () => {
    expect(findCapturedLiveArtifact(artifactEvidence, screenshotId)).toEqual({
      artifactId: screenshotId,
      digest: "c".repeat(64),
      byteSize: 1_024,
      mediaType: "image/png",
    });
    expect(findCapturedLiveArtifact(artifactEvidence, recordingId)).toEqual({
      artifactId: recordingId,
      digest: "d".repeat(64),
      byteSize: 4_159_645,
      mediaType: "video/webm",
    });
  });

  it("rejects missing and withheld artifacts", () => {
    expect(() => findCapturedLiveArtifact(artifactEvidence, `artifact:${"9".repeat(64)}`)).toThrow(
      "Live artifact is not present in the sealed evidence manifest.",
    );
    expect(() =>
      findCapturedLiveArtifact(
        {
          checkpoints: [
            {
              name: "secret-state",
              side: "head",
              stateVersion: 1,
              path: "/account",
              captured: false,
              createdAt: timestamp,
            },
          ],
          recordings: [],
        },
        screenshotId,
      ),
    ).toThrow("Live artifact is not present in the sealed evidence manifest.");
  });
});

describe("Codex evidence handoff", () => {
  it("returns only IDs that were actually recorded, without grading their meaning", () => {
    expect(liveEvidenceAgentHandoff(evidence()).availableEvidenceIds).toEqual([
      "ledger:finish",
      "observation:checkout",
      "assert:wrong-line",
      `response:${"f".repeat(64)}`,
      screenshotId,
      recordingId,
    ]);
  });
});
