import { describe, expect, it } from "vitest";

import type { LiveBrowserEvidence } from "./live-browser";
import {
  liveBrowserEvidenceSchema,
  maximumLiveBrowserRecordingArtifactBytes,
} from "./live-protocol";

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
    apiResponses: [],
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

  it("validates paired API responses and their same-side deterministic assertions", () => {
    const baseResponseId = `response:${"1".repeat(64)}`;
    const headResponseId = `response:${"2".repeat(64)}`;
    const apiEvidence: LiveBrowserEvidence = {
      ...evidence(),
      assertions: [
        {
          id: "assert:api-base",
          name: "cart-total-api",
          sequence: 1,
          side: "base",
          stateVersion: 1,
          path: "/api/cart",
          kind: "api_json",
          locatorFingerprint: "3".repeat(64),
          sourceResponseId: baseResponseId,
          passed: true,
          expected: "JSON cart.total equals 36",
          actual: "36",
          createdAt: timestamp,
        },
        {
          id: "assert:api-head",
          name: "cart-total-api",
          sequence: 2,
          side: "head",
          stateVersion: 1,
          path: "/api/cart",
          kind: "api_json",
          locatorFingerprint: "3".repeat(64),
          sourceResponseId: headResponseId,
          passed: false,
          expected: "JSON cart.total equals 36",
          actual: "24",
          createdAt: timestamp,
        },
      ],
      matchedAssertionNames: ["cart-total-api"],
      apiResponses: [
        {
          id: baseResponseId,
          name: "cart-state",
          sequence: 1,
          side: "base",
          stateVersion: 1,
          method: "GET",
          path: "/api/cart",
          requestFingerprint: "4".repeat(64),
          status: 200,
          contentType: "application/json",
          bodySha256: "5".repeat(64),
          bodyPreview: '{"cart":{"total":36}}',
          bodyTruncated: false,
          capturedByteSize: 21,
          createdAt: timestamp,
        },
        {
          id: headResponseId,
          name: "cart-state",
          sequence: 2,
          side: "head",
          stateVersion: 1,
          method: "GET",
          path: "/api/cart",
          requestFingerprint: "4".repeat(64),
          status: 200,
          contentType: "application/json",
          bodySha256: "6".repeat(64),
          bodyPreview: '{"cart":{"total":24}}',
          bodyTruncated: false,
          capturedByteSize: 21,
          createdAt: timestamp,
        },
      ],
    };

    expect(liveBrowserEvidenceSchema.parse(apiEvidence).apiResponses).toHaveLength(2);
    expect(() =>
      liveBrowserEvidenceSchema.parse({
        ...apiEvidence,
        assertions: [
          { ...apiEvidence.assertions[0], sourceResponseId: headResponseId },
          apiEvidence.assertions[1],
        ],
      }),
    ).toThrow("same review side");
    expect(() =>
      liveBrowserEvidenceSchema.parse({
        ...apiEvidence,
        assertions: [
          { ...apiEvidence.assertions[0], sourceResponseId: undefined },
          apiEvidence.assertions[1],
        ],
      }),
    ).toThrow("require a source response");
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
          {
            ...oversized.recordings[0],
            byteSize: maximumLiveBrowserRecordingArtifactBytes + 1,
          },
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
