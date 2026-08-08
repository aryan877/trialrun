import {
  claimNextJob,
  claimNextRepositoryAnalysis,
  recoverExpiredAgentConnectionJobs,
  createDatabase,
  failJob,
  failRepositoryAnalysis,
  heartbeatJob,
  heartbeatRepositoryAnalysis,
  recoverExpiredJobs,
  recoverExpiredRepositoryAnalyses,
  succeedJob,
  succeedRepositoryAnalysis,
} from "@trialrun/db";

import { runnerConfig } from "./config";
import {
  createDatabaseZeropsCleanupStore,
  ZeropsCleanupClient,
  ZeropsCleanupWorker,
} from "./cleanup-worker";
import { runRepositoryAnalysis } from "./run-analysis";
import { runReview } from "./run-review";
import { WorkspaceLifecycleWorker } from "./workspace-lifecycle";
import { ZeropsWorkspacePlatformClient } from "./workspace-platform";

const connection = createDatabase(runnerConfig.DATABASE_URL, 6);
const shutdownController = new AbortController();
let stopping = false;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
    shutdownController.abort(new Error(`Runner received ${signal}.`));
  });
}

await Promise.all([
  recoverExpiredAgentConnectionJobs(connection.db),
  recoverExpiredJobs(connection.db),
  recoverExpiredRepositoryAnalyses(connection.db),
]);
const workspaceLifecycle =
  runnerConfig.TRIALRUN_ZEROPS_ACCESS_TOKEN &&
  runnerConfig.TRIALRUN_ZEROPS_CLIENT_ID &&
  runnerConfig.TRIALRUN_BRIDGE_SIGNING_PRIVATE_KEY_BASE64 &&
  runnerConfig.VAULT_KEY_BASE64 &&
  runnerConfig.REPOSITORY_MCP_PUBLIC_URL
    ? new WorkspaceLifecycleWorker({
        db: connection.db,
        claimantId: `${runnerConfig.RUNNER_ID}:workspace`,
        leaseSeconds: runnerConfig.RUNNER_LEASE_SECONDS,
        signingPrivateKeyBase64: runnerConfig.TRIALRUN_BRIDGE_SIGNING_PRIVATE_KEY_BASE64,
        vaultKeyBase64: runnerConfig.VAULT_KEY_BASE64,
        vaultKeyVersion: runnerConfig.VAULT_KEY_VERSION,
        repositoryMcpUrl: runnerConfig.REPOSITORY_MCP_PUBLIC_URL,
        platform: new ZeropsWorkspacePlatformClient({
          apiUrl: runnerConfig.TRIALRUN_ZEROPS_API_URL,
          accessToken: runnerConfig.TRIALRUN_ZEROPS_ACCESS_TOKEN,
          clientId: runnerConfig.TRIALRUN_ZEROPS_CLIENT_ID,
          sourceDirectory: runnerConfig.TRIALRUN_CODEX_WORKSPACE_SOURCE_DIRECTORY,
          zcliBinary: runnerConfig.ZCLI_BINARY,
          operationTimeoutMs: runnerConfig.RUNNER_JOB_TIMEOUT_SECONDS * 1_000,
        }),
        jobTimeoutMs: runnerConfig.RUNNER_JOB_TIMEOUT_SECONDS * 1_000,
        logError: (message) => process.stderr.write(`TrialRun workspace worker: ${message}\n`),
      })
    : null;
const cleanupTimeoutMs = Math.max(
  1_000,
  Math.min(
    runnerConfig.RUNNER_JOB_TIMEOUT_SECONDS * 1_000,
    runnerConfig.RUNNER_LEASE_SECONDS * 1_000 - 5_000,
  ),
);
const cleanupPromise =
  runnerConfig.TRIALRUN_ZEROPS_ACCESS_TOKEN && runnerConfig.TRIALRUN_ZEROPS_CLIENT_ID
    ? new ZeropsCleanupWorker({
        store: createDatabaseZeropsCleanupStore(connection.db),
        deleter: new ZeropsCleanupClient({
          apiUrl: runnerConfig.TRIALRUN_ZEROPS_API_URL,
          accessToken: runnerConfig.TRIALRUN_ZEROPS_ACCESS_TOKEN,
          clientId: runnerConfig.TRIALRUN_ZEROPS_CLIENT_ID,
          requestTimeoutMs: Math.min(30_000, cleanupTimeoutMs),
          operationTimeoutMs: cleanupTimeoutMs,
        }),
        claimantId: runnerConfig.RUNNER_ID,
        leaseSeconds: runnerConfig.RUNNER_LEASE_SECONDS,
        redactionValues: [runnerConfig.TRIALRUN_ZEROPS_ACCESS_TOKEN],
        logError: (message) => process.stderr.write(`TrialRun cleanup worker: ${message}\n`),
      }).run(shutdownController.signal)
    : Promise.resolve();
process.stdout.write(`TrialRun runner ${runnerConfig.RUNNER_ID} is ready.\n`);
let nextRecoveryAt = Date.now() + 30_000;

while (!stopping) {
  if (Date.now() >= nextRecoveryAt) {
    await Promise.all([
      recoverExpiredAgentConnectionJobs(connection.db),
      recoverExpiredJobs(connection.db),
      recoverExpiredRepositoryAnalyses(connection.db),
    ]);
    nextRecoveryAt = Date.now() + 30_000;
  }
  if (workspaceLifecycle && (await workspaceLifecycle.runOnce(shutdownController.signal))) {
    continue;
  }
  const analysis = await claimNextRepositoryAnalysis(
    connection.db,
    runnerConfig.RUNNER_ID,
    runnerConfig.RUNNER_LEASE_SECONDS,
  );
  if (analysis) {
    const analysisController = new AbortController();
    let analysisHeartbeatRunning = false;
    const analysisHeartbeat = setInterval(
      () => {
        if (analysisHeartbeatRunning) return;
        analysisHeartbeatRunning = true;
        void heartbeatRepositoryAnalysis(
          connection.db,
          analysis.job.id,
          runnerConfig.RUNNER_ID,
          runnerConfig.RUNNER_LEASE_SECONDS,
        )
          .then((renewed) => {
            if (!renewed) analysisController.abort(new Error("Runner lost its analysis lease."));
          })
          .catch((error: unknown) => analysisController.abort(error))
          .finally(() => {
            analysisHeartbeatRunning = false;
          });
      },
      Math.floor((runnerConfig.RUNNER_LEASE_SECONDS * 1_000) / 3),
    );
    const analysisTimeout = setTimeout(
      () => analysisController.abort(new Error("Repository analysis exceeded the runner timeout.")),
      runnerConfig.RUNNER_JOB_TIMEOUT_SECONDS * 1_000,
    );
    try {
      analysisController.signal.throwIfAborted();
      const recipe = await runRepositoryAnalysis(
        connection.db,
        analysis,
        analysisController.signal,
      );
      analysisController.signal.throwIfAborted();
      await succeedRepositoryAnalysis(
        connection.db,
        analysis.job.id,
        runnerConfig.RUNNER_ID,
        recipe.id,
      );
    } catch (error) {
      await failRepositoryAnalysis(
        connection.db,
        analysis.job,
        runnerConfig.RUNNER_ID,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      clearInterval(analysisHeartbeat);
      clearTimeout(analysisTimeout);
    }
    continue;
  }
  const claimed = await claimNextJob(
    connection.db,
    runnerConfig.RUNNER_ID,
    runnerConfig.RUNNER_LEASE_SECONDS,
  );
  if (!claimed) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, runnerConfig.RUNNER_POLL_MS));
    continue;
  }

  const jobController = new AbortController();
  let heartbeatRunning = false;
  const heartbeat = setInterval(
    () => {
      if (heartbeatRunning) return;
      heartbeatRunning = true;
      void heartbeatJob(
        connection.db,
        claimed.job.id,
        runnerConfig.RUNNER_ID,
        runnerConfig.RUNNER_LEASE_SECONDS,
      )
        .then((renewed) => {
          if (!renewed) jobController.abort(new Error("Runner lost its job lease."));
        })
        .catch((error: unknown) => jobController.abort(error))
        .finally(() => {
          heartbeatRunning = false;
        });
    },
    Math.floor((runnerConfig.RUNNER_LEASE_SECONDS * 1_000) / 3),
  );
  const timeout = setTimeout(
    () => jobController.abort(new Error("Review exceeded the configured runner timeout.")),
    runnerConfig.RUNNER_JOB_TIMEOUT_SECONDS * 1_000,
  );

  try {
    await runReview(connection.db, claimed.review, jobController.signal);
    jobController.signal.throwIfAborted();
    await succeedJob(connection.db, claimed.job.id, runnerConfig.RUNNER_ID);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failJob(connection.db, claimed.job, runnerConfig.RUNNER_ID, message);
  } finally {
    clearInterval(heartbeat);
    clearTimeout(timeout);
  }
}

if (!shutdownController.signal.aborted) shutdownController.abort(new Error("Runner stopped."));
await cleanupPromise;
await connection.close();
process.stdout.write("TrialRun runner stopped.\n");
