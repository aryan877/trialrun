import { resolve } from "node:path";

import { GitHubAppService } from "@trialrun/github";

import { runnerConfig, workspaceRoot } from "./config";
import { validateExecutorSourceBundle } from "./executor-source-preflight";
import type { RepositoryMcpNetwork, RepositoryMcpServer } from "./repository-mcp.js";

export function githubService(): GitHubAppService {
  if (!runnerConfig.GITHUB_APP_ID || !runnerConfig.GITHUB_PRIVATE_KEY_BASE64) {
    throw new Error("GitHub App credentials are required for repository work.");
  }
  return new GitHubAppService({
    appId: runnerConfig.GITHUB_APP_ID,
    privateKey: Buffer.from(runnerConfig.GITHUB_PRIVATE_KEY_BASE64, "base64").toString("utf8"),
    ...(runnerConfig.GITHUB_CLIENT_ID && runnerConfig.GITHUB_CLIENT_SECRET
      ? { clientId: runnerConfig.GITHUB_CLIENT_ID, clientSecret: runnerConfig.GITHUB_CLIENT_SECRET }
      : {}),
  });
}

export function executorSourceDirectory(): string {
  return validateExecutorSourceBundle(
    resolve(workspaceRoot, runnerConfig.TRIALRUN_ZEROPS_EXECUTOR_SOURCE_DIRECTORY),
  );
}

export function remoteRepositoryMcpNetwork(): RepositoryMcpNetwork {
  if (!runnerConfig.REPOSITORY_MCP_PUBLIC_URL || runnerConfig.REPOSITORY_MCP_PORT === 0) {
    throw new Error("Remote Codex requires the authenticated repository MCP proxy.");
  }
  return {
    bindHost: runnerConfig.REPOSITORY_MCP_BIND_HOST,
    port: runnerConfig.REPOSITORY_MCP_PORT,
    publicMcpUrl: runnerConfig.REPOSITORY_MCP_PUBLIC_URL,
  };
}

export function repositoryMcpUrl(server: RepositoryMcpServer, remote: boolean): string {
  if (!remote) return server.mcpUrl;
  if (!server.publicMcpUrl) {
    throw new Error("Remote Codex cannot reach the private repository MCP listener.");
  }
  return server.publicMcpUrl;
}
