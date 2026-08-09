import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { agentTerminalReportSchema } from "@trialrun/domain";
import { liveBrowserEvidenceSchema } from "@trialrun/executor";
import { afterEach, describe, expect, it } from "vitest";

import { validateAgentReportProvenance } from "./agent-report-provenance.js";
import { createRepositoryView } from "./repository-view.js";

const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);
const timestamp = "2026-08-09T12:00:00.000Z";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function evidence() {
  return liveBrowserEvidenceSchema.parse({
    status: {
      state: "finished",
      actionsUsed: 2,
      actionsRemaining: 198,
      checkpointsRemaining: 12,
      resetsRemaining: 4,
      expiresAt: timestamp,
      stateVersions: { base: 1, head: 1 },
    },
    ledger: [
      {
        id: "evidence:finished",
        sequence: 1,
        tool: "finish_review",
        input: {},
        startedAt: timestamp,
        completedAt: "2026-08-09T12:00:00.001Z",
        outcome: "success",
        result: "session sealed",
      },
    ],
    observations: [],
    assertions: [
      {
        id: "assert:observed-risk",
        name: "observed-risk",
        sequence: 1,
        side: "head",
        stateVersion: 1,
        path: "/checkout",
        kind: "visible",
        locatorFingerprint: "c".repeat(64),
        passed: false,
        expected: "visible",
        actual: "hidden",
        createdAt: timestamp,
      },
    ],
    matchedAssertionNames: [],
    apiResponses: [],
    checkpoints: [],
    matchedCheckpointNames: [],
    recordings: [
      { side: "base", captured: false, createdAt: timestamp },
      { side: "head", captured: false, createdAt: "2026-08-09T12:00:00.001Z" },
    ],
    events: [],
  });
}

function report(verdict: "pass" | "fail" | "inconclusive" = "fail") {
  return agentTerminalReportSchema.parse({
    schemaVersion: 2,
    missionId: "c29ec939-29a5-4a1d-89d0-3fb2752f21cc",
    termination: "mission_complete",
    verdict,
    evidenceSummary: "Codex reviewed the code and recorded the relevant live behavior.",
    evidenceIds: ["assert:observed-risk"],
    questionAnswers: [],
    codeStrengths: [],
    codeRiskFindings: [
      {
        id: "wrong-cart-line",
        sourceSha: headSha,
        category: "correctness",
        risk: "high",
        title: "The wrong cart line changes",
        summary: "The delegated handler selects the first row instead of the clicked row.",
        citations: [{ path: "app.ts", lineStart: 1, lineEnd: 1 }],
        verification: {
          state: "reproduced",
          reason: "",
          evidenceIds: ["assert:observed-risk"],
        },
      },
    ],
    limitations: [],
  });
}

async function repository() {
  const root = await mkdtemp(join(tmpdir(), "trialrun-provenance-"));
  roots.push(root);
  const baseDirectory = join(root, "base");
  const headDirectory = join(root, "head");
  await Promise.all([mkdir(baseDirectory), mkdir(headDirectory)]);
  await Promise.all([
    writeFile(join(baseDirectory, "app.ts"), "export const selected = 'clicked';\n"),
    writeFile(join(headDirectory, "app.ts"), "export const selected = 'first';\n"),
  ]);
  return createRepositoryView({ baseDirectory, headDirectory });
}

const sealedRun = {
  completedTools: [
    {
      itemId: "finish",
      server: "trialrun_live",
      tool: "finish_review",
      status: "completed" as const,
    },
  ],
};

describe("Codex report provenance", () => {
  it("accepts Codex's verdict without re-grading its meaning", async () => {
    const view = await repository();
    for (const verdict of ["pass", "fail", "inconclusive"] as const) {
      await expect(
        validateAgentReportProvenance({
          report: report(verdict),
          run: sealedRun,
          evidence: evidence(),
          repository: view,
          missionId: report(verdict).missionId,
          baseSha,
          headSha,
        }),
      ).resolves.toBeUndefined();
    }
  });

  it("rejects invented evidence IDs", async () => {
    const candidate = report();
    await expect(
      validateAgentReportProvenance({
        report: { ...candidate, evidenceIds: ["assert:invented"] },
        run: sealedRun,
        evidence: evidence(),
        repository: await repository(),
        missionId: candidate.missionId,
        baseSha,
        headSha,
      }),
    ).rejects.toThrow("not recorded in this review");
  });

  it("requires a sealed ledger and real cited source lines", async () => {
    const view = await repository();
    await expect(
      validateAgentReportProvenance({
        report: report(),
        run: { completedTools: [] },
        evidence: evidence(),
        repository: view,
        missionId: report().missionId,
        baseSha,
        headSha,
      }),
    ).rejects.toThrow("without sealing");

    const candidate = report();
    const [risk] = candidate.codeRiskFindings;
    if (!risk) throw new Error("Test report is missing its risk finding.");
    await expect(
      validateAgentReportProvenance({
        report: {
          ...candidate,
          codeRiskFindings: [
            { ...risk, citations: [{ path: "app.ts", lineStart: 10, lineEnd: 10 }] },
          ],
        },
        run: sealedRun,
        evidence: evidence(),
        repository: view,
        missionId: candidate.missionId,
        baseSha,
        headSha,
      }),
    ).rejects.toThrow("cites lines outside");
  });
});
