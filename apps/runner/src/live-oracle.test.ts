import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { agentTerminalReportSchema, type AgentTerminalReport } from "@trialrun/domain";
import { liveBrowserEvidenceSchema, type LiveBrowserEvidence } from "@trialrun/executor";
import { afterEach, describe, expect, it } from "vitest";

import { decideLiveVerdict, validateAgentHandoff } from "./live-oracle.js";
import { createRepositoryView } from "./repository-view.js";

const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);
const timestamp = "2026-08-08T12:00:00.000Z";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function evidence(headPassed = false): LiveBrowserEvidence {
  return liveBrowserEvidenceSchema.parse({
    status: {
      state: "finished",
      actionsUsed: 2,
      actionsRemaining: 198,
      checkpointsRemaining: 10,
      resetsRemaining: 4,
      expiresAt: timestamp,
      stateVersions: { base: 1, head: 1 },
    },
    ledger: [
      {
        id: "evidence:finish",
        sequence: 1,
        tool: "finish_review",
        input: {},
        startedAt: timestamp,
        completedAt: "2026-08-08T12:00:00.001Z",
        outcome: "success",
        result: "session sealed as finished",
      },
    ],
    observations: [],
    assertions: [
      {
        id: "assert:base-path",
        name: "checkout-path",
        sequence: 1,
        side: "base",
        stateVersion: 1,
        path: "/checkout",
        kind: "url",
        locatorFingerprint: "b".repeat(64),
        passed: true,
        expected: "path containing /checkout",
        actual: "/checkout",
        createdAt: timestamp,
      },
      {
        id: "assert:base",
        name: "checkout-total",
        sequence: 2,
        side: "base",
        stateVersion: 1,
        path: "/checkout",
        kind: "text",
        locatorFingerprint: "a".repeat(64),
        passed: true,
        expected: "text containing $10",
        actual: "$10",
        createdAt: timestamp,
      },
      {
        id: "assert:head-path",
        name: "checkout-path",
        sequence: 3,
        side: "head",
        stateVersion: 1,
        path: "/checkout",
        kind: "url",
        locatorFingerprint: "b".repeat(64),
        passed: true,
        expected: "path containing /checkout",
        actual: "/checkout",
        createdAt: "2026-08-08T12:00:00.001Z",
      },
      {
        id: "assert:head",
        name: "checkout-total",
        sequence: 4,
        side: "head",
        stateVersion: 1,
        path: "/checkout",
        kind: "text",
        locatorFingerprint: "a".repeat(64),
        passed: headPassed,
        expected: "text containing $10",
        actual: headPassed ? "$10" : "$11",
        createdAt: "2026-08-08T12:00:00.001Z",
      },
    ],
    matchedAssertionNames: ["checkout-path", "checkout-total"],
    checkpoints: [
      {
        artifactId: `artifact:${"1".repeat(64)}`,
        name: "checkout-ready",
        side: "base",
        stateVersion: 1,
        path: "/checkout",
        captured: true,
        digest: "1".repeat(64),
        byteSize: 10,
        mediaType: "image/png",
        createdAt: timestamp,
      },
      {
        artifactId: `artifact:${"2".repeat(64)}`,
        name: "checkout-ready",
        side: "head",
        stateVersion: 1,
        path: "/checkout",
        captured: true,
        digest: "2".repeat(64),
        byteSize: 10,
        mediaType: "image/png",
        createdAt: "2026-08-08T12:00:00.001Z",
      },
    ],
    matchedCheckpointNames: ["checkout-ready"],
    events: [],
  });
}

function report(extraIds: readonly string[] = []): AgentTerminalReport {
  return agentTerminalReportSchema.parse({
    schemaVersion: 1,
    missionId: "c29ec939-29a5-4a1d-89d0-3fb2752f21cc",
    termination: "mission_complete",
    evidenceSummary: "Checkout total differs between the exact commits.",
    evidenceIds: [
      "assert:base",
      "assert:head",
      "assert:base-path",
      "assert:head-path",
      `artifact:${"1".repeat(64)}`,
      `artifact:${"2".repeat(64)}`,
      ...extraIds,
    ],
    questionAnswers: [],
    codeStrengths: [
      {
        id: "typed-total",
        sourceSha: headSha,
        category: "correctness",
        title: "Total remains explicitly declared",
        summary: "The implementation exposes the total as a typed constant.",
        citations: [{ path: "app.ts", lineStart: 1, lineEnd: 1 }],
      },
    ],
    codeRiskFindings: [
      {
        id: "wrong-total",
        sourceSha: headSha,
        category: "correctness",
        risk: "high",
        title: "Checkout total changed",
        summary: "The PR renders a different total for the same journey.",
        citations: [{ path: "app.ts", lineStart: 1, lineEnd: 1 }],
        verification: {
          state: "reproduced",
          evidenceIds: ["assert:base", "assert:head"],
        },
      },
    ],
    limitations: [],
    oracleHandoff: "required",
  });
}

async function repository() {
  const root = await mkdtemp(join(tmpdir(), "trialrun-oracle-"));
  roots.push(root);
  const baseDirectory = join(root, "base");
  const headDirectory = join(root, "head");
  await Promise.all([mkdir(baseDirectory), mkdir(headDirectory)]);
  await Promise.all([
    writeFile(join(baseDirectory, "app.ts"), "export const total = 10;\n"),
    writeFile(join(headDirectory, "app.ts"), "export const total = 11;\n"),
  ]);
  return createRepositoryView({ baseDirectory, headDirectory });
}

describe("live review oracle", () => {
  it("fails only from an equivalent passing-base/failing-head pair", () => {
    expect(decideLiveVerdict({ report: report(), evidence: evidence() })).toMatchObject({
      verdict: "fail",
      findings: [expect.objectContaining({ kind: "behavior_regression" })],
    });
    expect(decideLiveVerdict({ report: report(), evidence: evidence(true) }).verdict).toBe("pass");
  });

  it("refuses weak, differently-targeted, or invalid-baseline evidence", () => {
    const mismatchedLocator = evidence(true);
    const assertionsWithWrongHeadLocator = mismatchedLocator.assertions.map((assertion) =>
      assertion.id === "assert:head"
        ? { ...assertion, locatorFingerprint: "c".repeat(64) }
        : assertion,
    );
    expect(
      decideLiveVerdict({
        report: report(),
        evidence: { ...mismatchedLocator, assertions: assertionsWithWrongHeadLocator },
      }).verdict,
    ).toBe("inconclusive");

    const onePair = evidence(true);
    expect(
      decideLiveVerdict({
        report: report(),
        evidence: {
          ...onePair,
          assertions: onePair.assertions.filter(({ name }) => name === "checkout-total"),
          matchedAssertionNames: ["checkout-total"],
        },
      }).verdict,
    ).toBe("inconclusive");

    const brokenBase = evidence(true);
    expect(
      decideLiveVerdict({
        report: report(),
        evidence: {
          ...brokenBase,
          assertions: [
            ...brokenBase.assertions,
            {
              id: "assert:base-broken",
              name: "base-broken",
              sequence: 5,
              side: "base",
              stateVersion: 1,
              path: "/checkout",
              kind: "visible",
              locatorFingerprint: "d".repeat(64),
              passed: false,
              expected: "visible",
              actual: "hidden",
              createdAt: "2026-08-08T12:00:00.002Z",
            },
          ],
        },
      }).verdict,
    ).toBe("inconclusive");
  });

  it("binds report IDs, reproduced findings, citations, and agent sealing to real evidence", async () => {
    const sealedEvidence = evidence();
    await expect(
      validateAgentHandoff({
        report: report(),
        run: {
          completedTools: [
            {
              itemId: "tool-1",
              server: "trialrun_live",
              tool: "finish_review",
              status: "completed",
            },
          ],
        },
        evidence: sealedEvidence,
        repository: await repository(),
        baseSha,
        headSha,
      }),
    ).resolves.toBeUndefined();

    await expect(
      validateAgentHandoff({
        report: report(["assert:invented"]),
        run: { completedTools: [] },
        evidence: sealedEvidence,
        repository: await repository(),
        baseSha,
        headSha,
      }),
    ).rejects.toThrow("not recorded");
  });
});
