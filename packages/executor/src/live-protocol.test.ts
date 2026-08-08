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
    events: [],
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
});
