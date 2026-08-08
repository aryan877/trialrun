import { describe, expect, it } from "vitest";

import type { LiveBrowserEvidence } from "./live-browser";
import { liveBrowserEvidenceSchema } from "./live-protocol";

const timestamp = "2026-08-08T12:00:00.000Z";

function evidence(): LiveBrowserEvidence {
  return {
    status: {
      state: "finished",
      actionsUsed: 0,
      actionsRemaining: 200,
      checkpointsRemaining: 12,
      resetsRemaining: 4,
      expiresAt: timestamp,
      stateVersions: { base: 0, head: 0 },
    },
    ledger: [],
    observations: [],
    assertions: [
      {
        id: "assert:base",
        name: "checkout-total",
        sequence: 1,
        side: "base",
        stateVersion: 0,
        path: "/checkout",
        kind: "text",
        locatorFingerprint: "a".repeat(64),
        passed: true,
        expected: "text containing $10",
        actual: "$10",
        createdAt: timestamp,
      },
      {
        id: "assert:head",
        name: "checkout-total",
        sequence: 2,
        side: "head",
        stateVersion: 0,
        path: "/checkout",
        kind: "text",
        locatorFingerprint: "a".repeat(64),
        passed: false,
        expected: "text containing $10",
        actual: "$11",
        createdAt: timestamp,
      },
    ],
    matchedAssertionNames: ["checkout-total"],
    checkpoints: [],
    matchedCheckpointNames: [],
    recordings: [],
    events: [],
  };
}

function sealedEvidence(): LiveBrowserEvidence {
  return {
    ...evidence(),
    ledger: [
      {
        id: "evidence:sealed",
        sequence: 1,
        tool: "finish_review",
        input: { state: "finished" },
        startedAt: timestamp,
        completedAt: timestamp,
        outcome: "success",
        result: "session sealed as finished",
      },
    ],
    recordings: [
      {
        artifactId: `artifact:${"b".repeat(64)}`,
        side: "base",
        captured: true,
        digest: "a".repeat(64),
        byteSize: 1_024,
        mediaType: "video/webm",
        createdAt: timestamp,
      },
      {
        side: "head",
        captured: false,
        createdAt: timestamp,
      },
    ],
  };
}

describe("liveBrowserEvidenceSchema", () => {
  it("accepts exact, ordered cross-side evidence", () => {
    expect(liveBrowserEvidenceSchema.parse(evidence()).matchedAssertionNames).toEqual([
      "checkout-total",
    ]);
  });

  it("rejects fabricated matched names and duplicate side/name records", () => {
    const fabricated = evidence();
    expect(() =>
      liveBrowserEvidenceSchema.parse({ ...fabricated, matchedAssertionNames: ["invented"] }),
    ).toThrow("exact base/head intersection");

    const duplicated = evidence();
    expect(() =>
      liveBrowserEvidenceSchema.parse({
        ...duplicated,
        assertions: [duplicated.assertions[0], duplicated.assertions[0]],
        matchedAssertionNames: [],
      }),
    ).toThrow("Assertion");
  });

  it("validates exact sealed base/head recording manifests", () => {
    expect(liveBrowserEvidenceSchema.parse(sealedEvidence()).recordings).toHaveLength(2);

    const incomplete = sealedEvidence();
    expect(() =>
      liveBrowserEvidenceSchema.parse({
        ...incomplete,
        recordings: [{ ...incomplete.recordings[0], digest: undefined }, incomplete.recordings[1]],
      }),
    ).toThrow("complete artifact manifest");

    const withheldMetadata = sealedEvidence();
    expect(() =>
      liveBrowserEvidenceSchema.parse({
        ...withheldMetadata,
        recordings: [
          withheldMetadata.recordings[0],
          { ...withheldMetadata.recordings[1], artifactId: undefined },
        ],
      }),
    ).toThrow("withheld recordings require none");

    const oversized = sealedEvidence();
    expect(() =>
      liveBrowserEvidenceSchema.parse({
        ...oversized,
        recordings: [
          { ...oversized.recordings[0], byteSize: 64 * 1_024 * 1_024 + 1 },
          oversized.recordings[1],
        ],
      }),
    ).toThrow();

    const duplicateSide = sealedEvidence();
    expect(() =>
      liveBrowserEvidenceSchema.parse({
        ...duplicateSide,
        recordings: [duplicateSide.recordings[0], { ...duplicateSide.recordings[1], side: "base" }],
      }),
    ).toThrow("Recording");
  });
});
