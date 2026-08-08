import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { and, eq, inArray, sql } from "drizzle-orm";

import {
  agentConnections,
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
import { CodexLiveAgent, type LiveAgentLifecycleEvent, type LiveAgentRunResult } from "./live-agent";
import { decideLiveVerdict, validateAgentHandoff } from "./live-oracle";
import { startRepositoryMcpServer, type RepositoryMcpServer } from "./repository-mcp";
import { createRepositoryView } from "./repository-view";
import { executorSourceDirectory, githubService } from "./services";

interface ExpectedArtifactIntegrity {
  readonly sha256: string;
  readonly sizeBytes: number;
}

interface AgentAccess {
  readonly connectionId: string | null;
  readonly mode: "managed" | "api_key";
  readonly apiKey?: string;
  readonly codexHome?: string;
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
  if (
    !runnerConfig.TRIALRUN_ZEROPS_ACCESS_TOKEN ||
    !runnerConfig.TRIALRUN_ZEROPS_CLIENT_ID
  ) {
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
  if (
    expected &&
    (stored.sha256 !== expected.sha256 || stored.sizeBytes !== expected.sizeBytes)
  ) {
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
        inArray(artifacts.kind, ["live_evidence", "screenshot", "application_log"]),
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
      checkpointCount: input.evidence.checkpoints.length,
      eventCount: input.evidence.events.length,
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
    throw new Error("Repository test secrets are required but the runner vault key is unavailable.");
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

function managedAgentAccess(connectionId: string | null): AgentAccess {
  if (runnerConfig.MANAGED_CODEX_HOME) {
    return {
      connectionId,
      mode: "managed",
      codexHome: resolve(runnerConfig.MANAGED_CODEX_HOME),
    };
  }
  if (runnerConfig.MANAGED_OPENAI_API_KEY) {
    return {
      connectionId,
      mode: "managed",
      apiKey: runnerConfig.MANAGED_OPENAI_API_KEY,
    };
  }
  throw new Error("Managed Codex is not configured with an API key or authenticated Codex home.");
}

async function loadAgentAccess(
  db: TrialRunDatabase,
  review: Review,
): Promise<AgentAccess> {
  const [connection] = await db
    .select()
    .from(agentConnections)
    .where(
      and(
        eq(agentConnections.userId, review.ownerUserId),
        eq(agentConnections.provider, "openai"),
        eq(agentConnections.status, "connected"),
        ...(review.agentConnectionId
          ? [eq(agentConnections.id, review.agentConnectionId)]
          : []),
      ),
    )
    .limit(1);

  if (!connection) return managedAgentAccess(null);
  if (connection.mode === "managed") return managedAgentAccess(connection.id);
  if (connection.mode === "codex_workspace") {
    throw new Error(
      "This review selected a Codex subscription workspace, but its authenticated Zerops bridge is not connected.",
    );
  }
  if (
    !runnerConfig.VAULT_KEY_BASE64 ||
    connection.keyVersion !== runnerConfig.VAULT_KEY_VERSION ||
    !connection.iv ||
    !connection.ciphertext ||
    !connection.authTag
  ) {
    throw new Error("The selected user API key cannot be decrypted with the active vault key.");
  }
  const key = decodeBase64Key(runnerConfig.VAULT_KEY_BASE64, "VAULT_KEY_BASE64");
  return {
    connectionId: connection.id,
    mode: "api_key",
    apiKey: decryptSecret(
      {
        keyVersion: connection.keyVersion,
        iv: connection.iv,
        ciphertext: connection.ciphertext,
        authTag: connection.authTag,
      },
      key,
      `trialrun:agent-connection:${connection.userId}:${connection.id}`,
    ),
  };
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
        objective: "Understand the PR, its surrounding code, callers, configuration, and existing tests.",
        priority: "high",
      },
      {
        id: "review-code-risks",
        kind: "review_code_risks",
        objective: "Report exact cited strengths and concrete code risks without overstating unproven claims.",
        priority: "high",
      },
      {
        id: "investigate-live-behavior",
        kind: "investigate_live_behavior",
        objective: "Interactively compare the real base and PR applications and reproduce the highest-value behavioral differences.",
        priority: "high",
      },
    ],
    questions: [
      { id: "change-intent", question: "What behavior and code paths does this PR change?" },
      { id: "code-quality", question: "What is implemented well and what concrete code risks remain?" },
      { id: "runtime-difference", question: "Which behavior differs between base and PR under equivalent live actions?" },
      { id: "release-confidence", question: "What does the recorded evidence support, and what remains untested?" },
    ],
    allowedSecretNames: [...new Set(input.secretNames)].sort(),
    capabilities: [
      "read_repository",
      "read_diff",
      "observe_browser",
      "count_locators",
      "act_browser",
      "inspect_browser_events",
      "read_application_logs",
      "switch_side",
      "reset_side",
      "capture_checkpoint",
    ],
    budgets: {
      maxToolCalls: 200,
      maxDurationSeconds: Math.max(
        30,
        Math.min(840, runnerConfig.RUNNER_JOB_TIMEOUT_SECONDS - 30),
      ),
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
      verification:
        finding.verification.state === "unproven"
          ? { ...finding.verification, reason: redact(finding.verification.reason) }
          : finding.verification,
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
  let comparisonVerdict: "pass" | "fail" | "inconclusive" | null = null;
  let comparisonSummary = "Review did not reach deterministic comparison.";
  let checkRunId = review.checkRunId;
  let source: Awaited<ReturnType<typeof reviewSource>> | null = null;
  let agentRun: LiveAgentRunResult | null = null;

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

  const move = async (next: ReviewStatus, message: string): Promise<void> => {
    await transitionReview(db, review.id, next, redactText(message, secretValues));
    status = next;
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
    const { token } = await github.getInstallationToken(
      source.installation.githubInstallationId,
      source.repository.githubRepositoryId,
    );
    staged = await stageGitHubReview({
      owner: source.repository.owner,
      repository: source.repository.name,
      installationToken: token,
      pullNumber: review.pullNumber,
      baseSha: review.baseSha,
      headSha: review.headSha,
    });
    const secrets = await loadTestSecrets(db, source.repository.id, source.recipe);
    secretValues.push(...Object.values(secrets));
    const agentAccess = await loadAgentAccess(db, review);
    if (agentAccess.apiKey) secretValues.push(agentAccess.apiKey);

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
    await move("planning", "Preparing a bounded live code-and-browser mission");
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
    });

    await move("running", "Codex is inspecting the PR and controlling both live applications");
    signal?.throwIfAborted();
    const rawAgentRun = await new CodexLiveAgent({
      codexBinary: runnerConfig.CODEX_BINARY,
      model: runnerConfig.CODEX_MODEL,
      reasoningEffort: runnerConfig.CODEX_REASONING_EFFORT,
    }).run({
      mission,
      repositoryContext: {
        owner: source.repository.owner,
        repository: source.repository.name,
        pullNumber: review.pullNumber,
        pullRequestTitle: pullRequest.title,
        pullRequestBody: pullRequest.body,
      },
      repositoryTools: {
        mcpUrl: repositoryMcp.mcpUrl,
        bearerToken: repositoryToken,
      },
      liveTools: provisionedEnvironment.liveReview,
      ...(agentAccess.apiKey ? { apiKey: agentAccess.apiKey } : {}),
      ...(agentAccess.codexHome ? { codexHome: agentAccess.codexHome } : {}),
      ...(signal ? { signal } : {}),
      onEvent: async (event) => {
        if (event.type === "thread.started") {
          await db
            .update(reviews)
            .set({ agentThreadId: event.threadId })
            .where(eq(reviews.id, review.id));
        }
        await safeEvent(`agent.${event.type}`, `Codex ${event.type.replace(".", " ")}`, eventPayload(event));
      },
    });
    agentRun = {
      ...rawAgentRun,
      report: redactAgentTerminalReport(rawAgentRun.report, secretValues),
    };
    const completedAgentRun = agentRun;

    liveEvidence = await provisionedEnvironment.sealLiveReview();
    await validateAgentHandoff({
      report: completedAgentRun.report,
      run: completedAgentRun,
      evidence: liveEvidence,
      repository: repositoryView,
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

    const [baseLogs, headLogs] = await Promise.all([
      environment.readLogs("base"),
      environment.readLogs("head"),
    ]);
    await persistLiveEvidence({
      db,
      store,
      reviewId: review.id,
      environment: provisionedEnvironment,
      evidence: liveEvidence,
      baseLogs,
      headLogs,
      secretValues,
      scratch,
    });
    evidencePersisted = true;

    await move("comparing", "Validating citations and deterministic matched evidence");
    const comparison = decideLiveVerdict({
      report: completedAgentRun.report,
      evidence: liveEvidence,
    });
    comparisonVerdict = comparison.verdict;
    comparisonSummary = comparison.summary;
    await db.transaction(async (tx) => {
      await tx.delete(findings).where(eq(findings.reviewId, review.id));
      await tx
        .update(reviews)
        .set({ verdict: comparison.verdict })
        .where(eq(reviews.id, review.id));
      const rows = [
        ...comparison.findings.map((finding) => ({
          reviewId: review.id,
          severity: finding.severity,
          kind: finding.kind,
          title: finding.title,
          summary: finding.summary,
          firstDivergentStep: null,
          evidence: finding.evidence,
        })),
        ...completedAgentRun.report.codeRiskFindings.map((finding) => ({
          reviewId: review.id,
          severity: finding.risk === "high" ? ("blocking" as const) : ("warning" as const),
          kind: `code_risk_${finding.category}`,
          title: finding.title,
          summary: finding.summary,
          firstDivergentStep: null,
          evidence: {
            findingId: finding.id,
            sourceSha: finding.sourceSha,
            citations: finding.citations,
            verification: finding.verification,
          },
        })),
      ];
      if (rows.length > 0) await tx.insert(findings).values(rows);
    });
    await safeEvent(`verdict.${comparison.verdict}`, comparison.summary, {
      runtimeFindingCount: comparison.findings.length,
      codeRiskCount: completedAgentRun.report.codeRiskFindings.length,
      codeStrengthCount: completedAgentRun.report.codeStrengths.length,
    });
    await move("publishing", "Evidence is saved; GitHub closes after teardown is proven");
    workCompleted = true;
  } catch (error) {
    const caught = rememberFailure(error);
    await safeEvent("review.error", caught.message);
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
      liveEvidence = liveEvidence ?? (workCompleted
        ? await environment.sealLiveReview()
        : await environment.cancelLiveReview());
      const [baseLogs, headLogs] = await Promise.all([
        environment.readLogs("base"),
        environment.readLogs("head"),
      ]);
      await persistLiveEvidence({
        db,
        store,
        reviewId: review.id,
        environment,
        evidence: liveEvidence,
        baseLogs,
        headLogs,
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
    firstFailure ||
    !workCompleted ||
    comparisonVerdict === null ||
    comparisonVerdict === "inconclusive"
      ? "inconclusive"
      : comparisonVerdict;
  let cancellationObserved = signal?.aborted === true;
  if (cancellationObserved) finalVerdict = "inconclusive";

  if (source && checkRunId) {
    const github = githubService();
    const detailsUrl = new URL(`/app/reviews/${review.id}`, runnerConfig.APP_URL).href;
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
        detailsUrl,
        conclusion,
        title: cancellationObserved
          ? "Review was cancelled"
          : finalVerdict === "pass"
            ? "PR matched the base behavior"
            : finalVerdict === "fail"
              ? "Behavioral regression reproduced"
              : "Review was inconclusive",
        summary: cancellationObserved
          ? "Review cancellation was observed before GitHub publication completed. Available evidence was preserved and the disposable environment was cleaned up."
          : finalVerdict === "inconclusive"
            ? (firstFailure?.message ?? comparisonSummary)
            : comparisonSummary,
        text: [
          "One live Codex thread reviewed the code and interactively tested both immutable commits.",
          agentRun
            ? `${agentRun.report.codeStrengths.length} code strengths and ${agentRun.report.codeRiskFindings.length} code risks were recorded.`
            : "The live agent did not produce a validated terminal report.",
          "Open TrialRun for matched assertions, screenshots, application logs, and teardown proof.",
        ].join("\n\n"),
      });
    };
    try {
      await publishCheck();
      if (!cancellationObserved && signal?.aborted) {
        cancellationObserved = true;
        finalVerdict = "inconclusive";
        await publishCheck();
      }
    } catch (error) {
      rememberFailure(error);
      firstFailure = failures[0];
      finalVerdict = "inconclusive";
    }

    try {
      await github.createPullRequestComment(source.installation.githubInstallationId, {
        owner: source.repository.owner,
        repository: source.repository.name,
        pullNumber: review.pullNumber,
        body: [
          `### TrialRun: ${finalVerdict}`,
          "",
          finalVerdict === "inconclusive"
            ? (firstFailure?.message ?? comparisonSummary)
            : comparisonSummary,
          "",
          agentRun
            ? `Codex recorded **${agentRun.report.codeStrengths.length} strengths** and **${agentRun.report.codeRiskFindings.length} code risks** before the deterministic evidence oracle decided this result.`
            : "The live Codex investigation did not finish with a validated report.",
          "",
          `[Matched evidence and teardown proof](${detailsUrl})`,
        ].join("\n"),
      });
      if (!cancellationObserved && signal?.aborted) {
        cancellationObserved = true;
        finalVerdict = "inconclusive";
        await publishCheck();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "GitHub comment delivery failed.";
      await safeEvent("github.comment_failed", redactText(message, secretValues));
    }
  }

  cancellationObserved ||= signal?.aborted === true;
  if (cancellationObserved) {
    await db.update(reviews).set({ verdict: "inconclusive" }).where(eq(reviews.id, review.id));
    if (status !== "cancelled") await move("cancelled", "Review cancelled after evidence preservation and cleanup");
    return;
  }
  if (failures[0] || finalVerdict === "inconclusive") {
    await db.update(reviews).set({ verdict: "inconclusive" }).where(eq(reviews.id, review.id));
    if (status !== "inconclusive") {
      await move("inconclusive", failures[0]?.message ?? comparisonSummary);
    }
    return;
  }
  await db.update(reviews).set({ verdict: finalVerdict }).where(eq(reviews.id, review.id));
  await move("completed", "Evidence saved, GitHub published, and disposable environment deletion confirmed");
}
