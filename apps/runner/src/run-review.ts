import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import {
  appendReviewEvent,
  artifacts,
  findings,
  githubInstallations,
  repositories,
  repositoryRecipes,
  repositorySecrets,
  reviews,
  transitionReview,
  type Review,
  type TrialRunDatabase,
} from "@trialrun/db";
import {
  agentMissionSchema,
  agentRunMetricsSchema,
  agentTerminalReportSchema,
  decodeBase64Key,
  derivePublicProofToken,
  decryptSecret,
  hashToken,
  randomToken,
  redactText,
  type AgentMission,
  type AgentTerminalReport,
  type PolicyApprovedRecipe,
  type ReviewStatus,
} from "@trialrun/domain";
import {
  LocalArtifactStore,
  LocalExecutionProvider,
  S3ArtifactStore,
  stageGitHubReview,
  ZeropsExecutionProvider,
  type ArtifactStore,
  type ExecutionEnvironment,
  type ExecutionProvider,
  type LiveBrowserEvidence,
  type StagedGitReview,
} from "@trialrun/executor";

import { runnerConfig, workspaceRoot } from "./config";
import { loadAgentAccess, workspaceBridgeClient } from "./agent-access.js";
import { assertReviewProviderMatchesRunner } from "./executor-source-preflight";
import { stageGitHubSourceWithFreshToken } from "./github-source-staging";
import {
  CodexLiveAgent,
  type LiveAgentLifecycleEvent,
  type LiveAgentRunResult,
} from "./live-agent";
import { validateAgentReportProvenance } from "./agent-report-provenance";
import { startRepositoryMcpServer, type RepositoryMcpServer } from "./repository-mcp";
import { createRepositoryView } from "./repository-view";
import { isReviewCancellationSignal } from "./review-cancellation";
import {
  executorSourceDirectory,
  githubService,
  remoteRepositoryMcpNetwork,
  repositoryMcpUrl,
} from "./services";

interface ExpectedArtifactIntegrity {
  readonly sha256: string;
  readonly sizeBytes: number;
}

function artifactStore(): ArtifactStore {
  if (runnerConfig.ARTIFACT_DRIVER === "local") {
    const root = isAbsolute(runnerConfig.ARTIFACT_ROOT)
      ? runnerConfig.ARTIFACT_ROOT
      : resolve(workspaceRoot, runnerConfig.ARTIFACT_ROOT);
    return new LocalArtifactStore(root);
  }
  if (!runnerConfig.S3_ACCESS_KEY_ID || !runnerConfig.S3_SECRET_ACCESS_KEY) {
    throw new Error("S3 credentials were not validated.");
  }
  return new S3ArtifactStore({
    ...(runnerConfig.S3_ENDPOINT ? { endpoint: runnerConfig.S3_ENDPOINT } : {}),
    region: runnerConfig.S3_REGION,
    bucket: runnerConfig.S3_BUCKET,
    accessKeyId: runnerConfig.S3_ACCESS_KEY_ID,
    secretAccessKey: runnerConfig.S3_SECRET_ACCESS_KEY,
    forcePathStyle: runnerConfig.S3_FORCE_PATH_STYLE === "true",
  });
}

function executionProvider(): ExecutionProvider {
  if (runnerConfig.EXECUTION_PROVIDER === "local") {
    return new LocalExecutionProvider();
  }
  if (!runnerConfig.TRIALRUN_ZEROPS_ACCESS_TOKEN || !runnerConfig.TRIALRUN_ZEROPS_CLIENT_ID) {
    throw new Error("Zerops provider credentials were not validated.");
  }
  return new ZeropsExecutionProvider({
    apiUrl: runnerConfig.TRIALRUN_ZEROPS_API_URL,
    accessToken: runnerConfig.TRIALRUN_ZEROPS_ACCESS_TOKEN,
    clientId: runnerConfig.TRIALRUN_ZEROPS_CLIENT_ID,
    executorSourceDirectory: executorSourceDirectory(),
    zcliBinary: runnerConfig.ZCLI_BINARY,
    timeoutMs: runnerConfig.RUNNER_JOB_TIMEOUT_SECONDS * 1_000,
  });
}

function mediaType(path: string): string {
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webm")) return "video/webm";
  if (path.endsWith(".zip")) return "application/zip";
  if (path.endsWith(".json")) return "application/json";
  return "text/plain; charset=utf-8";
}

async function persistFile(
  db: TrialRunDatabase,
  store: ArtifactStore,
  reviewId: string,
  side: "base" | "head" | "review",
  kind: string,
  label: string,
  path: string,
  metadata: Readonly<Record<string, unknown>> = {},
  expected?: ExpectedArtifactIntegrity,
): Promise<void> {
  const stored = await store.putFile(reviewId, path, label, mediaType(path));
  if (expected && (stored.sha256 !== expected.sha256 || stored.sizeBytes !== expected.sizeBytes)) {
    throw new Error(`Persisted artifact ${label} did not match its sealed evidence manifest.`);
  }
  await db.insert(artifacts).values({
    reviewId,
    side,
    kind,
    storageKey: stored.storageKey,
    mediaType: mediaType(path),
    sha256: stored.sha256,
    sizeBytes: stored.sizeBytes,
    label,
    metadata,
  });
}

function boundedRedactedLogs(logs: string, secretValues: readonly string[]): string {
  const redacted = redactText(logs, secretValues);
  const bytes = Buffer.from(redacted, "utf8");
  const maximumBytes = 128 * 1_024;
  if (bytes.byteLength <= maximumBytes) return redacted;
  return `[earlier output removed]\n${bytes
    .subarray(bytes.byteLength - maximumBytes)
    .toString("utf8")
    .replace(/^\uFFFD/u, "")}`;
}

const applicationLogCollectionTimeoutMs = 35_000;

export async function collectAvailableApplicationLogs(
  environment: Pick<ExecutionEnvironment, "readLogs">,
  secretValues: readonly string[],
): Promise<{ readonly base: string; readonly head: string }> {
  const readSide = async (side: "base" | "head"): Promise<string> => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        environment.readLogs(side),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Application log collection exceeded its time limit.")),
            applicationLogCollectionTimeoutMs,
          );
        }),
      ]);
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      const message = redactText(raw, secretValues).slice(0, 2_000);
      return `[TrialRun could not collect ${side} application logs: ${message}]`;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };

  const [base, head] = await Promise.all([readSide("base"), readSide("head")]);
  return { base, head };
}

export function pullRequestEvidenceComment(input: {
  readonly detailsUrl: string;
  readonly codeStrengthCount?: number;
  readonly codeRiskCount?: number;
  readonly evidence?: {
    readonly baseScreenshotUrl: string;
    readonly headScreenshotUrl: string;
    readonly baseRecordingUrl: string;
    readonly headRecordingUrl: string;
  };
}): string {
  const proof = input.evidence
    ? [
        "",
        "| Base commit | Pull request |",
        "| --- | --- |",
        `| ![Base evidence](${input.evidence.baseScreenshotUrl}) | ![Pull request evidence](${input.evidence.headScreenshotUrl}) |`,
        "",
        `[Watch base recording](${input.evidence.baseRecordingUrl}) · [Watch pull request recording](${input.evidence.headRecordingUrl})`,
      ]
    : [];
  return [
    "### TrialRun evidence is ready",
    "",
    "One Codex thread reviewed the change, tested the running applications through Chrome and HTTP, and wrote this verdict. The GitHub Check is the authoritative current status.",
    "",
    input.codeStrengthCount === undefined || input.codeRiskCount === undefined
      ? "The live Codex investigation did not finish with a validated report."
      : `Codex recorded **${input.codeStrengthCount} strengths** and **${input.codeRiskCount} code risks** in its review.`,
    ...proof,
    "",
    `[Open recorded evidence, hashes, and Zerops deletion proof](${input.detailsUrl})`,
    "",
    "The disposable Zerops project was deleted before this comment was published.",
  ].join("\n");
}

interface PublicProofLinks {
  readonly detailsUrl: string;
  readonly baseScreenshotUrl: string;
  readonly headScreenshotUrl: string;
  readonly baseRecordingUrl: string;
  readonly headRecordingUrl: string;
}

function publicProofArtifactUrl(
  appUrl: string,
  reviewId: string,
  token: string,
  artifactId?: string,
): string {
  const path = artifactId
    ? `/proof/reviews/${reviewId}/${token}/artifacts/${artifactId}`
    : `/proof/reviews/${reviewId}/${token}`;
  return new URL(path, appUrl).href;
}

async function publicProofLinks(input: {
  readonly db: TrialRunDatabase;
  readonly reviewId: string;
  readonly report: AgentTerminalReport;
}): Promise<PublicProofLinks | null> {
  if (!runnerConfig.VAULT_KEY_BASE64) return null;
  const rows = await input.db
    .select()
    .from(artifacts)
    .where(
      and(
        eq(artifacts.reviewId, input.reviewId),
        inArray(artifacts.kind, ["screenshot", "browser_recording"]),
      ),
    )
    .orderBy(asc(artifacts.createdAt));
  const citedPairs = (evidenceIds: readonly string[]) => {
    const cited = new Set(evidenceIds);
    return rows.flatMap((baseScreenshot) => {
      const checkpointName = baseScreenshot.metadata["checkpointName"];
      const baseArtifactId = baseScreenshot.metadata["artifactId"];
      if (
        baseScreenshot.kind !== "screenshot" ||
        baseScreenshot.side !== "base" ||
        typeof checkpointName !== "string" ||
        typeof baseArtifactId !== "string" ||
        !cited.has(baseArtifactId)
      ) {
        return [];
      }
      const headScreenshot = rows.find(({ kind, side, metadata }) => {
        const headArtifactId = metadata["artifactId"];
        return (
          kind === "screenshot" &&
          side === "head" &&
          metadata["checkpointName"] === checkpointName &&
          typeof headArtifactId === "string" &&
          cited.has(headArtifactId)
        );
      });
      return headScreenshot ? [{ baseScreenshot, headScreenshot }] : [];
    });
  };
  const evidenceGroups = [
    ...input.report.codeRiskFindings.flatMap(({ verification }) =>
      verification.state === "reproduced" ? [verification.evidenceIds] : [],
    ),
    input.report.evidenceIds,
  ];
  let citedPair:
    | {
        readonly baseScreenshot: (typeof rows)[number];
        readonly headScreenshot: (typeof rows)[number];
      }
    | undefined;
  for (const evidenceIds of evidenceGroups) {
    const pairs = citedPairs(evidenceIds);
    if (pairs.length > 1) return null;
    if (pairs[0]) {
      citedPair = pairs[0];
      break;
    }
  }
  const baseScreenshot = citedPair?.baseScreenshot;
  const headScreenshot = citedPair?.headScreenshot;
  const baseRecording = rows.find(
    ({ kind, side }) => kind === "browser_recording" && side === "base",
  );
  const headRecording = rows.find(
    ({ kind, side }) => kind === "browser_recording" && side === "head",
  );
  if (!baseScreenshot || !headScreenshot || !baseRecording || !headRecording) {
    return null;
  }
  const token = derivePublicProofToken(
    input.reviewId,
    decodeBase64Key(runnerConfig.VAULT_KEY_BASE64, "VAULT_KEY_BASE64"),
  );
  return {
    detailsUrl: publicProofArtifactUrl(runnerConfig.APP_URL, input.reviewId, token),
    baseScreenshotUrl: publicProofArtifactUrl(
      runnerConfig.APP_URL,
      input.reviewId,
      token,
      baseScreenshot.id,
    ),
    headScreenshotUrl: publicProofArtifactUrl(
      runnerConfig.APP_URL,
      input.reviewId,
      token,
      headScreenshot.id,
    ),
    baseRecordingUrl: publicProofArtifactUrl(
      runnerConfig.APP_URL,
      input.reviewId,
      token,
      baseRecording.id,
    ),
    headRecordingUrl: publicProofArtifactUrl(
      runnerConfig.APP_URL,
      input.reviewId,
      token,
      headRecording.id,
    ),
  };
}

async function persistLiveEvidence(input: {
  readonly db: TrialRunDatabase;
  readonly store: ArtifactStore;
  readonly reviewId: string;
  readonly environment: ExecutionEnvironment;
  readonly evidence: LiveBrowserEvidence;
  readonly baseLogs: string;
  readonly headLogs: string;
  readonly secretValues: readonly string[];
  readonly scratch: string;
}): Promise<void> {
  await input.db
    .delete(artifacts)
    .where(
      and(
        eq(artifacts.reviewId, input.reviewId),
        inArray(artifacts.kind, [
          "live_evidence",
          "screenshot",
          "browser_recording",
          "application_log",
        ]),
      ),
    );

  const evidencePath = join(input.scratch, "live-evidence.json");
  await writeFile(evidencePath, JSON.stringify(input.evidence, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  await persistFile(
    input.db,
    input.store,
    input.reviewId,
    "review",
    "live_evidence",
    "live-evidence-ledger",
    evidencePath,
    {
      state: input.evidence.status.state,
      assertionCount: input.evidence.assertions.length,
      apiAssertionCount: input.evidence.assertions.filter(({ kind }) => kind.startsWith("api_"))
        .length,
      apiResponseCount: input.evidence.apiResponses.length,
      checkpointCount: input.evidence.checkpoints.length,
      eventCount: input.evidence.events.length,
      recordingCount: input.evidence.recordings.filter(({ captured }) => captured).length,
    },
  );

  for (const checkpoint of input.evidence.checkpoints) {
    if (
      !checkpoint.captured ||
      !checkpoint.artifactId ||
      !checkpoint.digest ||
      checkpoint.byteSize === undefined
    ) {
      continue;
    }
    const bytes = await input.environment.readLiveArtifact(checkpoint.artifactId);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== checkpoint.digest || bytes.byteLength !== checkpoint.byteSize) {
      throw new Error(`Checkpoint ${checkpoint.name} bytes did not match sealed evidence.`);
    }
    const screenshotPath = join(
      input.scratch,
      `${checkpoint.side}-${checkpoint.name}-${checkpoint.artifactId.slice(-12)}.png`,
    );
    await writeFile(screenshotPath, bytes, { mode: 0o600 });
    await persistFile(
      input.db,
      input.store,
      input.reviewId,
      checkpoint.side,
      "screenshot",
      `${checkpoint.side}-${checkpoint.name}`,
      screenshotPath,
      {
        artifactId: checkpoint.artifactId,
        checkpointName: checkpoint.name,
        stateVersion: checkpoint.stateVersion,
      },
      { sha256: checkpoint.digest, sizeBytes: checkpoint.byteSize },
    );
  }

  for (const recording of input.evidence.recordings) {
    if (
      !recording.captured ||
      !recording.artifactId ||
      !recording.digest ||
      recording.byteSize === undefined
    ) {
      continue;
    }
    const bytes = await input.environment.readLiveArtifact(recording.artifactId);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== recording.digest || bytes.byteLength !== recording.byteSize) {
      throw new Error(`${recording.side} browser recording did not match sealed evidence.`);
    }
    const recordingPath = join(input.scratch, `${recording.side}-browser-review.webm`);
    await writeFile(recordingPath, bytes, { mode: 0o600 });
    await persistFile(
      input.db,
      input.store,
      input.reviewId,
      recording.side,
      "browser_recording",
      `${recording.side}-browser-review`,
      recordingPath,
      {
        artifactId: recording.artifactId,
        createdAt: recording.createdAt,
      },
      { sha256: recording.digest, sizeBytes: recording.byteSize },
    );
  }

  for (const [side, logs] of [
    ["base", input.baseLogs],
    ["head", input.headLogs],
  ] as const) {
    const logPath = join(input.scratch, `${side}-application.log`);
    await writeFile(logPath, boundedRedactedLogs(logs, input.secretValues), {
      encoding: "utf8",
      mode: 0o600,
    });
    await persistFile(
      input.db,
      input.store,
      input.reviewId,
      side,
      "application_log",
      `${side}-application-log`,
      logPath,
    );
  }
}

async function reviewSource(db: TrialRunDatabase, review: Review) {
  const [source] = await db
    .select({
      repository: repositories,
      installation: githubInstallations,
      recipe: repositoryRecipes,
    })
    .from(repositories)
    .innerJoin(githubInstallations, eq(repositories.installationId, githubInstallations.id))
    .innerJoin(repositoryRecipes, eq(repositoryRecipes.id, review.recipeId))
    .where(
      and(
        eq(repositories.id, review.repositoryId),
        eq(githubInstallations.ownerUserId, review.ownerUserId),
        eq(repositoryRecipes.repositoryId, review.repositoryId),
      ),
    )
    .limit(1);
  if (!source || !source.repository.isActive || source.installation.suspendedAt) {
    throw new Error("The review repository or GitHub installation is unavailable.");
  }
  if (source.recipe.status !== "confirmed" || !source.recipe.approvedRecipe) {
    throw new Error("The review does not reference a confirmed infrastructure recipe.");
  }
  return {
    repository: source.repository,
    installation: source.installation,
    recipe: source.recipe.approvedRecipe,
  };
}

async function loadTestSecrets(
  db: TrialRunDatabase,
  repositoryId: string,
  recipe: PolicyApprovedRecipe,
): Promise<Readonly<Record<string, string>>> {
  const names = [...new Set(recipe.secretBindings.map(({ secretName }) => secretName))];
  if (names.length === 0) return {};
  if (!runnerConfig.VAULT_KEY_BASE64) {
    throw new Error(
      "Repository test secrets are required but the runner vault key is unavailable.",
    );
  }
  const key = decodeBase64Key(runnerConfig.VAULT_KEY_BASE64, "VAULT_KEY_BASE64");
  const records = await db
    .select()
    .from(repositorySecrets)
    .where(
      and(eq(repositorySecrets.repositoryId, repositoryId), inArray(repositorySecrets.name, names)),
    );
  const byName = new Map(records.map((record) => [record.name, record]));
  return Object.fromEntries(
    names.map((name) => {
      const record = byName.get(name);
      if (!record) throw new Error(`Required repository test secret ${name} is missing.`);
      if (record.keyVersion !== runnerConfig.VAULT_KEY_VERSION) {
        throw new Error(`Repository test secret ${name} uses an unavailable vault key version.`);
      }
      return [
        name,
        decryptSecret(record, key, `trialrun:repository-secret:${repositoryId}:${name}`),
      ];
    }),
  );
}

function createMission(input: {
  readonly review: Review;
  readonly pullRequestTitle: string;
  readonly secretNames: readonly string[];
}): AgentMission {
  return agentMissionSchema.parse({
    schemaVersion: 1,
    missionId: randomUUID(),
    reviewId: input.review.id,
    baseSha: input.review.baseSha,
    headSha: input.review.headSha,
    title: `Review PR #${input.review.pullNumber}: ${input.pullRequestTitle}`.slice(0, 160),
    goals: [
      {
        id: "understand-change",
        kind: "understand_change",
        objective:
          "Understand the PR, its surrounding code, callers, configuration, and existing tests.",
        priority: "high",
      },
      {
        id: "review-code-risks",
        kind: "review_code_risks",
        objective:
          "Report exact cited strengths and concrete code risks without overstating unproven claims.",
        priority: "high",
      },
      {
        id: "investigate-live-behavior",
        kind: "investigate_live_behavior",
        objective:
          "Interactively compare the real base and PR applications through their user interface and relevant HTTP endpoints, then reproduce the highest-value behavioral differences.",
        priority: "high",
      },
    ],
    questions: [
      { id: "change-intent", question: "What behavior and code paths does this PR change?" },
      {
        id: "code-quality",
        question: "What is implemented well and what concrete code risks remain?",
      },
      {
        id: "runtime-difference",
        question:
          "Which browser or HTTP API behavior differs between base and PR under an equivalent live action or request?",
      },
      {
        id: "release-confidence",
        question: "What does the recorded evidence support, and what remains untested?",
      },
    ],
    allowedSecretNames: [...new Set(input.secretNames)].sort(),
    capabilities: [
      "read_repository",
      "read_diff",
      "observe_browser",
      "count_locators",
      "act_browser",
      "inspect_browser_events",
      "request_application",
      "read_application_logs",
      "switch_side",
      "reset_side",
      "capture_checkpoint",
    ],
    budgets: {
      maxToolCalls: 200,
      maxDurationSeconds: Math.max(30, Math.min(840, runnerConfig.RUNNER_JOB_TIMEOUT_SECONDS - 30)),
      maxCheckpoints: 12,
      maxResets: 4,
    },
  });
}

function redactAgentTerminalReport(
  report: AgentTerminalReport,
  secretValues: readonly string[],
): AgentTerminalReport {
  const redact = (value: string): string => redactText(value, secretValues);
  return agentTerminalReportSchema.parse({
    ...report,
    evidenceSummary: redact(report.evidenceSummary),
    questionAnswers: report.questionAnswers.map((answer) => ({
      ...answer,
      answer: redact(answer.answer),
    })),
    codeStrengths: report.codeStrengths.map((finding) => ({
      ...finding,
      title: redact(finding.title),
      summary: redact(finding.summary),
    })),
    codeRiskFindings: report.codeRiskFindings.map((finding) => ({
      ...finding,
      title: redact(finding.title),
      summary: redact(finding.summary),
      verification: {
        ...finding.verification,
        reason: redact(finding.verification.reason),
      },
    })),
    limitations: report.limitations.map(redact),
  });
}

function eventPayload(event: LiveAgentLifecycleEvent): Record<string, unknown> {
  switch (event.type) {
    case "thread.started":
      return { threadId: event.threadId };
    case "tool.started":
    case "tool.completed":
    case "tool.failed":
      return { itemId: event.itemId, server: event.server, tool: event.tool };
    case "turn.completed":
      return { usage: event.usage };
    case "turn.failed":
      return { message: event.message };
  }
}

export async function runReview(
  db: TrialRunDatabase,
  review: Review,
  signal?: AbortSignal,
): Promise<void> {
  assertReviewProviderMatchesRunner(review.provider, runnerConfig.EXECUTION_PROVIDER);
  const provider = executionProvider();
  const store = artifactStore();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(review.id)
  ) {
    throw new Error("Review ID is not a valid UUID.");
  }
  const scratch = join(workspaceRoot, ".data/runs", review.id);
  await mkdir(scratch, { recursive: true });
  let environment: ExecutionEnvironment | null = null;
  let staged: StagedGitReview | null = null;
  let repositoryMcp: RepositoryMcpServer | null = null;
  let liveEvidence: LiveBrowserEvidence | null = null;
  let evidencePersisted = false;
  let status: ReviewStatus = review.status;
  let workCompleted = false;
  const failures: Error[] = [];
  const secretValues: string[] = [];
  let agentVerdict: "pass" | "fail" | "inconclusive" | null = null;
  let agentSummary = "Codex did not return a validated review.";
  let checkRunId = review.checkRunId;
  let source: Awaited<ReturnType<typeof reviewSource>> | null = null;
  let agentRun: LiveAgentRunResult | null = null;
  let githubPublished = false;
  let publishCancellationCheck: (() => Promise<void>) | null = null;

  const rememberFailure = (error: unknown): Error => {
    const raw = error instanceof Error ? error.message : String(error);
    const normalized = new Error(redactText(raw, secretValues).slice(0, 8_000));
    if (failures.length === 0) failures.push(normalized);
    return normalized;
  };

  const safeEvent = async (
    type: string,
    message: string,
    payload: Record<string, unknown> = {},
  ): Promise<void> => {
    try {
      await appendReviewEvent(
        db,
        review.id,
        type,
        redactText(message, secretValues).slice(0, 2_000),
        payload,
      );
    } catch (error) {
      rememberFailure(error);
    }
  };

  const move = async (next: ReviewStatus, message: string): Promise<ReviewStatus> => {
    status = await transitionReview(db, review.id, next, redactText(message, secretValues));
    return status;
  };

  try {
    signal?.throwIfAborted();
    source = await reviewSource(db, review);
    const github = githubService();
    const pullRequest = await github.resolvePullRequest({
      installationId: source.installation.githubInstallationId,
      owner: source.repository.owner,
      repository: source.repository.name,
      pullNumber: review.pullNumber,
    });
    if (pullRequest.state !== "open" || pullRequest.draft) {
      throw new Error("TrialRun executes only open, review-ready pull requests.");
    }
    if (pullRequest.baseSha !== review.baseSha || pullRequest.headSha !== review.headSha) {
      throw new Error("GitHub pull request SHAs changed after this review was queued.");
    }
    const detailsUrl = new URL(`/app/reviews/${review.id}`, runnerConfig.APP_URL).href;
    if (!checkRunId) {
      checkRunId = await github.createQueuedCheck(source.installation.githubInstallationId, {
        owner: source.repository.owner,
        repository: source.repository.name,
        headSha: review.headSha,
        detailsUrl,
        title: "TrialRun is preparing exact commits",
        summary: "The confirmed repository recipe is queued for isolated base-versus-PR execution.",
      });
      await db.update(reviews).set({ checkRunId }).where(eq(reviews.id, review.id));
    }
    await github.markCheckInProgress(source.installation.githubInstallationId, {
      owner: source.repository.owner,
      repository: source.repository.name,
      headSha: review.headSha,
      checkRunId,
      detailsUrl,
      title: "TrialRun is provisioning both commits",
      summary: "The base and PR commits are being prepared from immutable GitHub SHAs.",
    });
    const sourceForStage = source;
    staged = await stageGitHubSourceWithFreshToken({
      issueToken: () =>
        github
          .getInstallationToken(
            sourceForStage.installation.githubInstallationId,
            sourceForStage.repository.githubRepositoryId,
          )
          .then(({ token }) => token),
      stage: (installationToken) =>
        stageGitHubReview({
          owner: sourceForStage.repository.owner,
          repository: sourceForStage.repository.name,
          installationToken,
          pullNumber: review.pullNumber,
          baseSha: review.baseSha,
          headSha: review.headSha,
        }),
      ...(signal ? { signal } : {}),
    });
    const secrets = await loadTestSecrets(db, source.repository.id, source.recipe);
    secretValues.push(...Object.values(secrets));
    const agentAccess = await loadAgentAccess(db, {
      userId: review.ownerUserId,
      connectionId: review.agentConnectionId,
    });
    if (agentAccess.mode !== "codex_workspace" && agentAccess.apiKey) {
      secretValues.push(agentAccess.apiKey);
    }

    const ownershipTokenHash = hashToken(randomToken());
    await db
      .update(reviews)
      .set({
        agentConnectionId: agentAccess.connectionId,
        providerOwnershipTokenHash: ownershipTokenHash,
      })
      .where(eq(reviews.id, review.id));

    await move("provisioning", `Creating an isolated ${review.provider} environment`);
    environment = await provider.provision({
      reviewId: review.id,
      ownershipTokenHash,
      recipe: source.recipe,
      sourceWorkspaces: staged.sourceWorkspaces,
      secrets,
      ...(signal ? { signal } : {}),
      onProjectCreated: async (providerProjectId) => {
        await db.update(reviews).set({ providerProjectId }).where(eq(reviews.id, review.id));
        await appendReviewEvent(
          db,
          review.id,
          "environment.created",
          `${review.provider} environment created`,
          { providerProjectId },
        );
      },
      onServiceProgress: async (progress) => {
        await safeEvent("environment.service", `${progress.hostname} is ${progress.state}`, {
          ...progress,
        });
      },
    });
    signal?.throwIfAborted();
    await db
      .update(reviews)
      .set({
        providerProjectId: environment.providerProjectId,
        baseUrl: environment.baseUrl,
        headUrl: environment.headUrl,
      })
      .where(eq(reviews.id, review.id));
    await move("building", "Base and PR applications passed readiness checks");
    const provisionedEnvironment = environment;

    const mission = createMission({
      review,
      pullRequestTitle: pullRequest.title,
      secretNames: Object.keys(secrets),
    });
    await move("planning", "Preparing a bounded live code, browser, and API mission");
    await db.update(reviews).set({ agentMission: mission }).where(eq(reviews.id, review.id));
    await safeEvent("mission.ready", mission.title, {
      missionId: mission.missionId,
      goalCount: mission.goals.length,
      maxToolCalls: mission.budgets.maxToolCalls,
      maxDurationSeconds: mission.budgets.maxDurationSeconds,
    });

    const repositoryView = await createRepositoryView({
      baseDirectory: staged.sourceWorkspaces.base.directory,
      headDirectory: staged.sourceWorkspaces.head.directory,
    });
    const repositoryToken = randomToken();
    repositoryMcp = await startRepositoryMcpServer({
      view: repositoryView,
      executionToken: repositoryToken,
      readApplicationLogs: async (side) =>
        boundedRedactedLogs(await provisionedEnvironment.readLogs(side), secretValues),
      ...(agentAccess.mode === "codex_workspace" ? { network: remoteRepositoryMcpNetwork() } : {}),
    });

    await move(
      "running",
      "Codex is inspecting the PR and testing both live applications through Chrome and HTTP",
    );
    signal?.throwIfAborted();
    const repositoryTools = {
      mcpUrl: repositoryMcpUrl(repositoryMcp, agentAccess.mode === "codex_workspace"),
      bearerToken: repositoryToken,
    };
    const repositoryContext = {
      owner: source.repository.owner,
      repository: source.repository.name,
      pullNumber: review.pullNumber,
      pullRequestTitle: pullRequest.title,
      pullRequestBody: pullRequest.body,
    };
    const rawAgentRun =
      agentAccess.mode === "codex_workspace"
        ? await workspaceBridgeClient(agentAccess)
            .invoke(
              {
                kind: "review",
                mission,
                repositoryContext,
                repositoryTools,
                liveTools: provisionedEnvironment.liveReview,
              },
              mission.budgets.maxDurationSeconds * 1_000 + 30_000,
              signal,
            )
            .then(async (result) => {
              if (result.kind !== "review") {
                throw new Error("Codex workspace returned an analysis result for a review job.");
              }
              for (const event of result.events) {
                if (event.type === "thread.started") {
                  await db
                    .update(reviews)
                    .set({ agentThreadId: event.threadId })
                    .where(eq(reviews.id, review.id));
                }
                await safeEvent(
                  `agent.${event.type}`,
                  `Codex ${event.type.replace(".", " ")}`,
                  eventPayload(event),
                );
              }
              return result.run;
            })
        : await new CodexLiveAgent({
            codexBinary: runnerConfig.CODEX_BINARY,
            model: runnerConfig.CODEX_MODEL,
            reasoningEffort: runnerConfig.CODEX_REASONING_EFFORT,
          }).run({
            mission,
            repositoryContext,
            repositoryTools,
            liveTools: provisionedEnvironment.liveReview,
            ...(agentAccess.apiKey ? { apiKey: agentAccess.apiKey } : {}),
            ...(agentAccess.mode === "managed" && agentAccess.codexHome
              ? { codexHome: agentAccess.codexHome }
              : {}),
            ...(signal ? { signal } : {}),
            onEvent: async (event) => {
              if (event.type === "thread.started") {
                await db
                  .update(reviews)
                  .set({ agentThreadId: event.threadId })
                  .where(eq(reviews.id, review.id));
              }
              await safeEvent(
                `agent.${event.type}`,
                `Codex ${event.type.replace(".", " ")}`,
                eventPayload(event),
              );
            },
          });
    agentRun = {
      ...rawAgentRun,
      report: redactAgentTerminalReport(rawAgentRun.report, secretValues),
    };
    const completedAgentRun = agentRun;

    liveEvidence = await provisionedEnvironment.sealLiveReview();
    await validateAgentReportProvenance({
      report: completedAgentRun.report,
      run: completedAgentRun,
      evidence: liveEvidence,
      repository: repositoryView,
      missionId: mission.missionId,
      baseSha: review.baseSha,
      headSha: review.headSha,
    });
    const metrics = agentRunMetricsSchema.parse({
      usage: completedAgentRun.usage,
      toolCalls: completedAgentRun.toolCalls,
      startedAt: completedAgentRun.startedAt,
      completedAt: completedAgentRun.completedAt,
    });
    await db
      .update(reviews)
      .set({
        agentThreadId: completedAgentRun.threadId,
        agentTerminalReport: completedAgentRun.report,
        agentRunMetrics: metrics,
      })
      .where(eq(reviews.id, review.id));

    const logs = await collectAvailableApplicationLogs(environment, secretValues);
    await persistLiveEvidence({
      db,
      store,
      reviewId: review.id,
      environment: provisionedEnvironment,
      evidence: liveEvidence,
      baseLogs: logs.base,
      headLogs: logs.head,
      secretValues,
      scratch,
    });
    evidencePersisted = true;

    await move("comparing", "Verifying Codex's code citations and recorded evidence");
    agentVerdict = completedAgentRun.report.verdict;
    agentSummary = completedAgentRun.report.evidenceSummary;
    await db.transaction(async (tx) => {
      await tx.delete(findings).where(eq(findings.reviewId, review.id));
      await tx
        .update(reviews)
        .set({ verdict: completedAgentRun.report.verdict })
        .where(eq(reviews.id, review.id));
      const rows = completedAgentRun.report.codeRiskFindings.map((finding) => ({
        reviewId: review.id,
        severity: finding.risk === "high" ? ("blocking" as const) : ("warning" as const),
        kind: `code_risk_${finding.category}`,
        title: finding.title,
        summary: finding.summary,
        evidence: {
          findingId: finding.id,
          sourceSha: finding.sourceSha,
          citations: finding.citations,
          verification: finding.verification,
        },
      }));
      if (rows.length > 0) await tx.insert(findings).values(rows);
    });
    await safeEvent(`verdict.${completedAgentRun.report.verdict}`, agentSummary, {
      codeRiskCount: completedAgentRun.report.codeRiskFindings.length,
      codeStrengthCount: completedAgentRun.report.codeStrengths.length,
    });
    await move("publishing", "Evidence is saved; GitHub closes after teardown is proven");
    workCompleted = true;
  } catch (error) {
    if (isReviewCancellationSignal(signal)) {
      await safeEvent("review.cancel_requested", "Review cancellation reached the active runner");
    } else {
      const caught = rememberFailure(error);
      await safeEvent("review.error", caught.message);
    }
  }

  if (repositoryMcp) {
    try {
      await repositoryMcp.close();
    } catch (error) {
      rememberFailure(error);
    }
  }

  if (environment && !evidencePersisted) {
    try {
      liveEvidence =
        liveEvidence ??
        (workCompleted ? await environment.sealLiveReview() : await environment.cancelLiveReview());
      const logs = await collectAvailableApplicationLogs(environment, secretValues);
      await persistLiveEvidence({
        db,
        store,
        reviewId: review.id,
        environment,
        evidence: liveEvidence,
        baseLogs: logs.base,
        headLogs: logs.head,
        secretValues,
        scratch,
      });
      evidencePersisted = true;
    } catch (error) {
      rememberFailure(error);
    }
  }

  if (environment) {
    try {
      if (status !== "tearing_down") {
        await move("tearing_down", "Destroying the disposable environment");
      }
    } catch (error) {
      rememberFailure(error);
    }
    try {
      await db
        .update(reviews)
        .set({
          teardownStartedAt: new Date(),
          teardownAttempts: sql`${reviews.teardownAttempts} + 1`,
        })
        .where(eq(reviews.id, review.id));
    } catch (error) {
      rememberFailure(error);
    }
    try {
      const proof = await environment.destroy();
      if (!proof.deleted) rememberFailure(new Error(proof.message));
      try {
        await db
          .update(reviews)
          .set({
            teardownCompletedAt: proof.deleted ? new Date(proof.completedAt) : null,
            teardownLastError: proof.deleted ? null : proof.message,
            teardownProof: {
              startedAt: proof.startedAt,
              completedAt: proof.completedAt,
              providerProjectId: proof.providerProjectId,
              deleted: proof.deleted,
              message: proof.message,
            },
          })
          .where(eq(reviews.id, review.id));
      } catch (error) {
        rememberFailure(error);
      }
      await safeEvent("environment.deleted", proof.message, {
        providerProjectId: proof.providerProjectId,
        deleted: proof.deleted,
        completedAt: proof.completedAt,
      });
    } catch (error) {
      const caught = rememberFailure(error);
      try {
        await db
          .update(reviews)
          .set({ teardownLastError: caught.message })
          .where(eq(reviews.id, review.id));
      } catch (databaseError) {
        rememberFailure(databaseError);
      }
      await safeEvent("teardown.error", caught.message);
    }
  }

  if (staged) {
    try {
      await staged.cleanup();
    } catch (error) {
      rememberFailure(error);
    }
  }

  try {
    await rm(scratch, { recursive: true, force: true });
  } catch (error) {
    rememberFailure(error);
  }

  let firstFailure = failures[0];
  let finalVerdict: "pass" | "fail" | "inconclusive" =
    firstFailure || !workCompleted || agentVerdict === null ? "inconclusive" : agentVerdict;
  let cancellationObserved = isReviewCancellationSignal(signal);
  if (cancellationObserved) finalVerdict = "inconclusive";

  if (source && checkRunId) {
    const github = githubService();
    const ownerDetailsUrl = new URL(`/app/reviews/${review.id}`, runnerConfig.APP_URL).href;
    let proofLinks: PublicProofLinks | undefined;
    if (
      !firstFailure &&
      !cancellationObserved &&
      finalVerdict !== "inconclusive" &&
      liveEvidence &&
      agentRun
    ) {
      try {
        proofLinks =
          (await publicProofLinks({ db, reviewId: review.id, report: agentRun.report })) ??
          undefined;
        if (!proofLinks) {
          await safeEvent(
            "proof.inline_unavailable",
            "GitHub will link the private review because a complete paired media preview was not recorded",
          );
        }
      } catch (error) {
        const message = redactText(
          error instanceof Error ? error.message : String(error),
          secretValues,
        );
        await safeEvent("proof.inline_unavailable", message.slice(0, 2_000));
      }
    }
    const detailsUrl = () =>
      finalVerdict === "inconclusive" || cancellationObserved || !proofLinks
        ? ownerDetailsUrl
        : proofLinks.detailsUrl;
    const publishCheck = async () => {
      const conclusion = cancellationObserved
        ? "cancelled"
        : finalVerdict === "pass"
          ? "success"
          : finalVerdict === "fail"
            ? "failure"
            : "neutral";
      await github.completeCheck(source.installation.githubInstallationId, {
        owner: source.repository.owner,
        repository: source.repository.name,
        headSha: review.headSha,
        checkRunId,
        detailsUrl: detailsUrl(),
        conclusion,
        title: cancellationObserved
          ? "Review was cancelled"
          : finalVerdict === "pass"
            ? "Codex approved this pull request"
            : finalVerdict === "fail"
              ? "Codex found blocking risks"
              : "Review was inconclusive",
        summary: cancellationObserved
          ? "Review cancellation was observed before GitHub publication completed. Available evidence was preserved and the disposable environment was cleaned up."
          : finalVerdict === "inconclusive"
            ? (firstFailure?.message ?? agentSummary)
            : agentSummary,
        text: [
          "One live Codex thread reviewed the code and interactively tested both immutable commits.",
          agentRun
            ? `${agentRun.report.codeStrengths.length} code strengths and ${agentRun.report.codeRiskFindings.length} code risks were recorded.`
            : "The live agent did not produce a validated terminal report.",
          "Open TrialRun for Codex's cited evidence, screenshots, recordings, application logs, and teardown proof.",
        ].join("\n\n"),
      });
    };
    publishCancellationCheck = async () => {
      cancellationObserved = true;
      finalVerdict = "inconclusive";
      await publishCheck();
    };
    try {
      await publishCheck();
      if (!cancellationObserved && isReviewCancellationSignal(signal)) {
        cancellationObserved = true;
        finalVerdict = "inconclusive";
        await publishCheck();
      }
      const commentId = await github.createPullRequestComment(
        source.installation.githubInstallationId,
        {
          owner: source.repository.owner,
          repository: source.repository.name,
          pullNumber: review.pullNumber,
          body: pullRequestEvidenceComment({
            detailsUrl: detailsUrl(),
            ...(proofLinks && finalVerdict !== "inconclusive" && !cancellationObserved
              ? { evidence: proofLinks }
              : {}),
            ...(agentRun
              ? {
                  codeStrengthCount: agentRun.report.codeStrengths.length,
                  codeRiskCount: agentRun.report.codeRiskFindings.length,
                }
              : {}),
          }),
        },
      );
      await safeEvent("github.check_published", "GitHub Check completed", { checkRunId });
      await safeEvent("github.comment_published", "Pull request comment published", {
        commentId,
      });
      if (!cancellationObserved && isReviewCancellationSignal(signal)) {
        cancellationObserved = true;
        finalVerdict = "inconclusive";
        await publishCheck();
      }
      githubPublished = true;
    } catch (error) {
      const caught = rememberFailure(error);
      firstFailure = failures[0];
      finalVerdict = "inconclusive";
      await safeEvent("github.publish_failed", caught.message);
      try {
        await publishCheck();
      } catch (checkError) {
        rememberFailure(checkError);
      }
    }
  }

  const alignCheckWithTerminalCancellation = async (actualStatus: ReviewStatus): Promise<void> => {
    if (actualStatus !== "cancelled" || cancellationObserved) return;
    const publish = publishCancellationCheck;
    if (!publish) return;
    try {
      await publish();
      await safeEvent("github.check_published", "GitHub Check updated for cancellation", {
        ...(checkRunId ? { checkRunId } : {}),
      });
    } catch (error) {
      const caught = rememberFailure(error);
      await safeEvent("github.publish_failed", caught.message);
    }
  };

  cancellationObserved ||= isReviewCancellationSignal(signal);
  if (cancellationObserved) {
    await db.update(reviews).set({ verdict: "inconclusive" }).where(eq(reviews.id, review.id));
    if (status !== "cancelled")
      await move("cancelled", "Review cancelled after evidence preservation and cleanup");
    return;
  }
  if (failures[0] || finalVerdict === "inconclusive" || !githubPublished) {
    await db.update(reviews).set({ verdict: "inconclusive" }).where(eq(reviews.id, review.id));
    if (status !== "inconclusive") {
      const actualStatus = await move(
        "inconclusive",
        failures[0]?.message ??
          (githubPublished ? agentSummary : "GitHub publication was not fully verified."),
      );
      await alignCheckWithTerminalCancellation(actualStatus);
    }
    return;
  }
  await db.update(reviews).set({ verdict: finalVerdict }).where(eq(reviews.id, review.id));
  const actualStatus = await move(
    "completed",
    "Evidence saved, GitHub published, and disposable environment deletion confirmed",
  );
  await alignCheckWithTerminalCancellation(actualStatus);
}
