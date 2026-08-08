import type { AgentTerminalReport } from "@trialrun/domain";
import type { LiveBrowserEvidence } from "@trialrun/executor";

import type { LiveAgentRunResult } from "./live-agent.js";
import type { RepositoryView } from "./repository-view.js";

export interface LiveOracleFinding {
  readonly severity: "blocking" | "warning";
  readonly kind: "behavior_regression" | "invalid_baseline" | "insufficient_evidence";
  readonly title: string;
  readonly summary: string;
  readonly evidence: Readonly<Record<string, unknown>>;
}

export interface LiveOracleResult {
  readonly verdict: "pass" | "fail" | "inconclusive";
  readonly summary: string;
  readonly findings: readonly LiveOracleFinding[];
}

function evidenceIds(evidence: LiveBrowserEvidence): ReadonlySet<string> {
  return new Set([
    ...evidence.ledger.map(({ id }) => id),
    ...evidence.observations.map(({ id }) => id),
    ...evidence.assertions.map(({ id }) => id),
    ...evidence.checkpoints.flatMap(({ artifactId }) => (artifactId ? [artifactId] : [])),
    ...evidence.events.map(({ id }) => id),
  ]);
}

function assertionPair(evidence: LiveBrowserEvidence, name: string) {
  return {
    base: evidence.assertions.find(
      (assertion) => assertion.side === "base" && assertion.name === name,
    ),
    head: evidence.assertions.find(
      (assertion) => assertion.side === "head" && assertion.name === name,
    ),
  };
}

function checkpointPair(evidence: LiveBrowserEvidence, name: string) {
  return {
    base: evidence.checkpoints.find(
      (checkpoint) => checkpoint.side === "base" && checkpoint.name === name,
    ),
    head: evidence.checkpoints.find(
      (checkpoint) => checkpoint.side === "head" && checkpoint.name === name,
    ),
  };
}

function equivalentAssertionPair<T extends ReturnType<typeof assertionPair>>(
  pair: T,
): pair is T & {
  readonly base: NonNullable<T["base"]>;
  readonly head: NonNullable<T["head"]>;
} {
  return Boolean(
    pair.base &&
      pair.head &&
      pair.base.kind === pair.head.kind &&
      pair.base.expected === pair.head.expected &&
      pair.base.path === pair.head.path &&
      pair.base.locatorFingerprint === pair.head.locatorFingerprint,
  );
}

function equivalentCheckpointPair<T extends ReturnType<typeof checkpointPair>>(
  pair: T,
): pair is T & {
  readonly base: NonNullable<T["base"]>;
  readonly head: NonNullable<T["head"]>;
} {
  return Boolean(
    pair.base?.captured &&
      pair.head?.captured &&
      pair.base.path === pair.head.path,
  );
}

export async function validateAgentHandoff(input: {
  readonly report: AgentTerminalReport;
  readonly run: Pick<LiveAgentRunResult, "completedTools">;
  readonly evidence: LiveBrowserEvidence;
  readonly repository: RepositoryView;
  readonly baseSha: string;
  readonly headSha: string;
}): Promise<void> {
  const realIds = evidenceIds(input.evidence);
  for (const id of input.report.evidenceIds) {
    if (!realIds.has(id)) throw new Error(`Codex cited an evidence ID that was not recorded: ${id}`);
  }
  const finishedByAgent = input.run.completedTools.some(
    ({ server, tool, status }) =>
      server === "trialrun_live" && tool === "finish_review" && status === "completed",
  );
  if (input.report.termination === "mission_complete" && !finishedByAgent) {
    throw new Error("Codex declared mission completion without successfully sealing the live review.");
  }

  const reportIds = new Set(input.report.evidenceIds);
  const citedAssertionPair = input.evidence.matchedAssertionNames.some((name) => {
    const pair = assertionPair(input.evidence, name);
    return Boolean(
      equivalentAssertionPair(pair) &&
        reportIds.has(pair.base.id) &&
        reportIds.has(pair.head.id),
    );
  });
  if (input.report.termination === "mission_complete" && !citedAssertionPair) {
    throw new Error("A completed mission must cite at least one matched base/head assertion pair.");
  }
  const citedCheckpointPair = input.evidence.matchedCheckpointNames.some((name) => {
    const pair = checkpointPair(input.evidence, name);
    return Boolean(
      equivalentCheckpointPair(pair) &&
        pair.base.artifactId &&
        pair.head.artifactId &&
        reportIds.has(pair.base.artifactId) &&
        reportIds.has(pair.head.artifactId),
    );
  });
  if (input.report.termination === "mission_complete" && !citedCheckpointPair) {
    throw new Error("A completed mission must cite at least one matched screenshot pair.");
  }

  for (const finding of input.report.codeRiskFindings) {
    if (finding.verification.state !== "reproduced") continue;
    const reproducedIds = new Set(finding.verification.evidenceIds);
    const provesRegression = input.evidence.matchedAssertionNames.some((name) => {
      const pair = assertionPair(input.evidence, name);
      return (
        equivalentAssertionPair(pair) &&
        pair.base.passed &&
        !pair.head.passed &&
        reproducedIds.has(pair.base.id) &&
        reproducedIds.has(pair.head.id)
      );
    });
    if (!provesRegression) {
      throw new Error(
        `Reproduced code risk ${finding.id} does not cite an equivalent passing-base/failing-head assertion pair.`,
      );
    }
  }

  const allFindings = [...input.report.codeStrengths, ...input.report.codeRiskFindings];
  for (const finding of allFindings) {
    const side =
      finding.sourceSha === input.baseSha
        ? "base"
        : finding.sourceSha === input.headSha
          ? "head"
          : null;
    if (side === null) throw new Error(`Finding ${finding.id} cites an unrelated source SHA.`);
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

export function decideLiveVerdict(input: {
  readonly report: AgentTerminalReport;
  readonly evidence: LiveBrowserEvidence;
}): LiveOracleResult {
  if (input.evidence.status.state !== "finished") {
    return {
      verdict: "inconclusive",
      summary: `Live evidence ended as ${input.evidence.status.state}, not finished.`,
      findings: [],
    };
  }
  if (input.report.termination !== "mission_complete") {
    return {
      verdict: "inconclusive",
      summary: `Codex ended the investigation as ${input.report.termination}.`,
      findings: [],
    };
  }
  const failedBaseAssertion = input.evidence.assertions.find(
    ({ side, passed }) => side === "base" && !passed,
  );
  if (failedBaseAssertion) {
    return {
      verdict: "inconclusive",
      summary: `The base commit failed assertion ${failedBaseAssertion.name}; the baseline is not trustworthy.`,
      findings: [
        {
          severity: "warning",
          kind: "invalid_baseline",
          title: "Base behavior did not satisfy the review contract",
          summary: `Base assertion ${failedBaseAssertion.name} failed, so TrialRun cannot infer a PR regression or a safe match.`,
          evidence: {
            baseAssertionId: failedBaseAssertion.id,
            name: failedBaseAssertion.name,
            path: failedBaseAssertion.path,
          },
        },
      ],
    };
  }
  const unmatchedFailedHeadAssertion = input.evidence.assertions.find(
    ({ side, name, passed }) =>
      side === "head" && !passed && !input.evidence.matchedAssertionNames.includes(name),
  );
  if (unmatchedFailedHeadAssertion) {
    return {
      verdict: "inconclusive",
      summary: `The PR failed assertion ${unmatchedFailedHeadAssertion.name}, but no equivalent base assertion was recorded.`,
      findings: [
        {
          severity: "warning",
          kind: "insufficient_evidence",
          title: "A PR failure is missing its base comparison",
          summary: `Head assertion ${unmatchedFailedHeadAssertion.name} failed without a same-contract base assertion.`,
          evidence: {
            headAssertionId: unmatchedFailedHeadAssertion.id,
            name: unmatchedFailedHeadAssertion.name,
            path: unmatchedFailedHeadAssertion.path,
          },
        },
      ],
    };
  }
  if (input.evidence.matchedCheckpointNames.length === 0) {
    return {
      verdict: "inconclusive",
      summary: "No matched base/head screenshot checkpoint was recorded.",
      findings: [
        {
          severity: "warning",
          kind: "insufficient_evidence",
          title: "Matched screenshot evidence is missing",
          summary: "TrialRun will not issue a behavioral verdict without an equivalent visual checkpoint from both commits.",
          evidence: {},
        },
      ],
    };
  }
  if (input.evidence.matchedAssertionNames.length < 2) {
    return {
      verdict: "inconclusive",
      summary: "At least two matched base/head assertions are required for a behavioral verdict.",
      findings: [],
    };
  }

  const checkpointPairs = input.evidence.matchedCheckpointNames.map((name) => ({
    name,
    ...checkpointPair(input.evidence, name),
  }));
  const mismatchedCheckpoint = checkpointPairs.find((pair) => !equivalentCheckpointPair(pair));
  if (mismatchedCheckpoint) {
    return {
      verdict: "inconclusive",
      summary: `Checkpoint ${mismatchedCheckpoint.name} was captured at different paths on base and PR.`,
      findings: [],
    };
  }
  const equivalentCheckpoints = checkpointPairs.filter(equivalentCheckpointPair);

  const pairs = input.evidence.matchedAssertionNames.map((name) => ({
    name,
    ...assertionPair(input.evidence, name),
  }));
  const mismatched = pairs.find((pair) => !equivalentAssertionPair(pair));
  if (mismatched) {
    return {
      verdict: "inconclusive",
      summary: `Assertion ${mismatched.name} used different contracts on base and head.`,
      findings: [],
    };
  }
  const equivalentPairs = pairs.filter(equivalentAssertionPair);
  if (!equivalentPairs.some(({ base }) => base.kind === "url")) {
    return {
      verdict: "inconclusive",
      summary: "Matched evidence must include a URL assertion that binds both commits to the same journey path.",
      findings: [],
    };
  }
  if (!equivalentPairs.some(({ base }) => base.kind !== "url")) {
    return {
      verdict: "inconclusive",
      summary: "Matched evidence must include a product-behavior assertion in addition to the URL contract.",
      findings: [],
    };
  }
  const checkpointCoversAssertionPath = equivalentCheckpoints.some(({ base: checkpoint }) =>
    equivalentPairs.some(({ base: assertion }) => assertion.path === checkpoint.path),
  );
  if (!checkpointCoversAssertionPath) {
    return {
      verdict: "inconclusive",
      summary: "Matched screenshots were not captured on a path covered by the matched assertions.",
      findings: [],
    };
  }
  const regressions = equivalentPairs.filter(({ head }) => !head.passed);
  if (regressions.length > 0) {
    const names = regressions.map(({ name }) => name);
    return {
      verdict: "fail",
      summary: `The PR regressed ${regressions.length} matched assertion${regressions.length === 1 ? "" : "s"}: ${names.join(", ")}.`,
      findings: regressions.map(({ name, base, head }) => ({
        severity: "blocking",
        kind: "behavior_regression",
        title: `Behavior changed at ${name}`,
        summary: `The same assertion passed on the base commit and failed on the PR commit.`,
        evidence: {
          name,
          baseAssertionId: base.id,
          headAssertionId: head.id,
          expected: base.expected,
          baseActual: base.actual,
          headActual: head.actual,
        },
      })),
    };
  }
  return {
    verdict: "pass",
    summary: `${equivalentPairs.length} matched deterministic assertion${equivalentPairs.length === 1 ? "" : "s"} passed on both commits with paired screenshot evidence.`,
    findings: [],
  };
}
