import {
  proposeRepositoryRecipe,
  type ClaimedRepositoryAnalysis,
  type RepositoryRecipe,
  type TrialRunDatabase,
} from "@trialrun/db";
import {
  CodexCliInfrastructureAnalyst,
  stageGitHubCommit,
} from "@trialrun/executor";
import {
  randomToken,
  type EvidenceCitation,
  type InfrastructureProposal,
} from "@trialrun/domain";

import { runnerConfig } from "./config";
import { loadAgentAccess, workspaceBridgeClient } from "./agent-access.js";
import { startRepositoryAnalysisMcpServer } from "./repository-mcp.js";
import { createSingleRepositoryView, type RepositoryView } from "./repository-view.js";
import {
  githubService,
  remoteRepositoryMcpNetwork,
  repositoryMcpUrl,
} from "./services";

function proposalCitations(proposal: InfrastructureProposal): readonly EvidenceCitation[] {
  return [
    ...proposal.applications.flatMap(({ evidence }) => evidence),
    ...proposal.dependencies.flatMap(({ evidence }) => evidence),
    ...proposal.environmentBindings.flatMap(({ evidence }) => evidence),
    ...proposal.secretBindings.flatMap(({ evidence }) => evidence),
  ];
}

async function verifyProposalCitations(
  view: RepositoryView,
  proposal: InfrastructureProposal,
): Promise<void> {
  const unique = new Map<string, EvidenceCitation>();
  for (const citation of proposalCitations(proposal)) {
    const key = `${citation.path}:${citation.lineStart}:${citation.lineEnd}`;
    unique.set(key, citation);
  }
  for (const citation of unique.values()) {
    if (citation.lineStart === undefined || citation.lineEnd === undefined) {
      throw new Error(`Infrastructure proposal citation ${citation.path} needs exact line numbers.`);
    }
    const range = await view.readFile({
      side: "head",
      path: citation.path,
      startLine: citation.lineStart,
      endLine: citation.lineEnd,
    });
    if (range.startLine !== citation.lineStart || range.endLine !== citation.lineEnd) {
      throw new Error(
        `Infrastructure proposal cites lines outside ${citation.path}: ${citation.lineStart}-${citation.lineEnd}.`,
      );
    }
  }
}

export async function runRepositoryAnalysis(
  db: TrialRunDatabase,
  claimed: ClaimedRepositoryAnalysis,
  signal?: AbortSignal,
): Promise<RepositoryRecipe> {
  if (runnerConfig.CODEX_ANALYST_ENABLED !== "true") {
    throw new Error("Repository analysis requires the bounded Codex analyst.");
  }
  const agentAccess = await loadAgentAccess(db, {
    userId: claimed.job.requestedByUserId,
    connectionId: claimed.job.agentConnectionId,
  });
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
  let repositoryTools: Awaited<ReturnType<typeof startRepositoryAnalysisMcpServer>> | null = null;
  try {
    const view = await createSingleRepositoryView({ directory: staged.workspace.directory });
    const repositoryToken = randomToken();
    repositoryTools = await startRepositoryAnalysisMcpServer({
      view,
      executionToken: repositoryToken,
      ...(agentAccess.mode === "codex_workspace"
        ? { network: remoteRepositoryMcpNetwork() }
        : {}),
    });
    const mcpUrl = repositoryMcpUrl(
      repositoryTools,
      agentAccess.mode === "codex_workspace",
    );
    const proposal =
      agentAccess.mode === "codex_workspace"
        ? await workspaceBridgeClient(agentAccess)
            .invoke(
              {
                kind: "analysis",
                sourceSha: claimed.job.sourceSha,
                repositoryTools: { mcpUrl, bearerToken: repositoryToken },
              },
              runnerConfig.RUNNER_JOB_TIMEOUT_SECONDS * 1_000,
              signal,
            )
            .then((result) => {
              if (result.kind !== "analysis") {
                throw new Error("Codex workspace returned a review result for an analysis job.");
              }
              return result.proposal;
            })
        : await new CodexCliInfrastructureAnalyst({
            binary: runnerConfig.CODEX_BINARY,
            model: runnerConfig.CODEX_MODEL,
            reasoningEffort: runnerConfig.CODEX_REASONING_EFFORT,
            timeoutMs: runnerConfig.RUNNER_JOB_TIMEOUT_SECONDS * 1_000,
            ...(agentAccess.apiKey ? { apiKey: agentAccess.apiKey } : {}),
            ...(agentAccess.mode === "managed" && agentAccess.codexHome
              ? { codexHome: agentAccess.codexHome }
              : {}),
          }).analyze({
            sourceSha: claimed.job.sourceSha,
            repositoryTools: { mcpUrl, bearerToken: repositoryToken },
            ...(signal ? { signal } : {}),
          });
    await verifyProposalCitations(view, proposal);
    const proposed = await proposeRepositoryRecipe(db, {
      repositoryId: claimed.repository.id,
      sourceSha: claimed.job.sourceSha,
      proposal,
      proposedByUserId: claimed.job.requestedByUserId,
      analysisJobId: claimed.job.id,
    });
    return proposed.record;
  } finally {
    await repositoryTools?.close();
    await staged.cleanup();
  }
}
