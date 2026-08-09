import type { AgentTerminalReport } from "@trialrun/domain";
import type { LiveBrowserEvidence } from "@trialrun/executor";

import type { LiveAgentRunResult } from "./live-agent.js";
import type { RepositoryView } from "./repository-view.js";

function recordedEvidenceIds(evidence: LiveBrowserEvidence): ReadonlySet<string> {
  return new Set([
    ...evidence.ledger.map(({ id }) => id),
    ...evidence.observations.map(({ id }) => id),
    ...evidence.assertions.map(({ id }) => id),
    ...evidence.apiResponses.map(({ id }) => id),
    ...evidence.checkpoints.flatMap(({ artifactId }) => (artifactId ? [artifactId] : [])),
    ...evidence.recordings.flatMap(({ artifactId }) => (artifactId ? [artifactId] : [])),
    ...evidence.events.map(({ id }) => id),
  ]);
}

export async function validateAgentReportProvenance(input: {
  readonly report: AgentTerminalReport;
  readonly run: Pick<LiveAgentRunResult, "completedTools">;
  readonly evidence: LiveBrowserEvidence;
  readonly repository: RepositoryView;
  readonly missionId: string;
  readonly baseSha: string;
  readonly headSha: string;
}): Promise<void> {
  if (input.report.missionId !== input.missionId) {
    throw new Error("Codex returned a report for a different review mission.");
  }
  const realEvidenceIds = recordedEvidenceIds(input.evidence);
  for (const id of input.report.evidenceIds) {
    if (!realEvidenceIds.has(id)) {
      throw new Error(`Codex cited evidence that was not recorded in this review: ${id}`);
    }
  }

  const sealedByAgent = input.run.completedTools.some(
    ({ server, tool, status }) =>
      server === "trialrun_live" && tool === "finish_review" && status === "completed",
  );
  if (!sealedByAgent) {
    throw new Error("Codex returned a review without sealing its evidence ledger.");
  }
  if (
    input.evidence.status.state !== "finished" ||
    !input.evidence.ledger.some(
      ({ tool, outcome }) => tool === "finish_review" && outcome === "success",
    )
  ) {
    throw new Error("Codex returned a review without a finished evidence ledger.");
  }

  for (const finding of [...input.report.codeStrengths, ...input.report.codeRiskFindings]) {
    const side =
      finding.sourceSha === input.baseSha
        ? "base"
        : finding.sourceSha === input.headSha
          ? "head"
          : null;
    if (side === null) throw new Error(`Finding ${finding.id} cites an unrelated source commit.`);
    for (const citation of finding.citations) {
      const range = await input.repository.readFile({
        side,
        path: citation.path,
        startLine: citation.lineStart,
        endLine: citation.lineEnd,
      });
      if (range.totalLines < citation.lineEnd || range.lines.length === 0) {
        throw new Error(
          `Finding ${finding.id} cites lines outside ${citation.path} at ${finding.sourceSha}.`,
        );
      }
    }
  }
}
