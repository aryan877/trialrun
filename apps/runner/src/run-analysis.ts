import {
  proposeRepositoryRecipe,
  type ClaimedRepositoryAnalysis,
  type RepositoryRecipe,
  type TrialRunDatabase,
} from "@trialrun/db";
import {
  CodexCliInfrastructureAnalyst,
  collectRepositoryEvidence,
  stageGitHubCommit,
} from "@trialrun/executor";

import { runnerConfig } from "./config";
import { githubService } from "./services";

export async function runRepositoryAnalysis(
  db: TrialRunDatabase,
  claimed: ClaimedRepositoryAnalysis,
): Promise<RepositoryRecipe> {
  if (runnerConfig.CODEX_ANALYST_ENABLED !== "true") {
    throw new Error("Repository analysis requires the bounded Codex analyst.");
  }
  const github = githubService();
  const { token } = await github.getInstallationToken(
    claimed.installation.githubInstallationId,
    claimed.repository.githubRepositoryId,
  );
  const staged = await stageGitHubCommit({
    owner: claimed.repository.owner,
    repository: claimed.repository.name,
    installationToken: token,
    sha: claimed.job.sourceSha,
  });
  try {
    const evidence = await collectRepositoryEvidence(staged.workspace.directory);
    const proposal = await new CodexCliInfrastructureAnalyst({
      binary: runnerConfig.CODEX_BINARY,
      model: runnerConfig.CODEX_MODEL,
      reasoningEffort: runnerConfig.CODEX_REASONING_EFFORT,
      timeoutMs: runnerConfig.RUNNER_JOB_TIMEOUT_SECONDS * 1_000,
      ...(runnerConfig.MANAGED_OPENAI_API_KEY
        ? { apiKey: runnerConfig.MANAGED_OPENAI_API_KEY }
        : {}),
      ...(runnerConfig.MANAGED_CODEX_HOME
        ? { codexHome: runnerConfig.MANAGED_CODEX_HOME }
        : {}),
    }).analyze({ sourceSha: claimed.job.sourceSha, evidence });
    const proposed = await proposeRepositoryRecipe(db, {
      repositoryId: claimed.repository.id,
      sourceSha: claimed.job.sourceSha,
      proposal,
      proposedByUserId: claimed.job.requestedByUserId,
      analysisJobId: claimed.job.id,
    });
    return proposed.record;
  } finally {
    await staged.cleanup();
  }
}
