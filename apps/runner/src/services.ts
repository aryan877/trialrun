import { resolve } from "node:path";

import { GitHubAppService } from "@trialrun/github";

import { runnerConfig, workspaceRoot } from "./config";

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
  return resolve(workspaceRoot, runnerConfig.TRIALRUN_ZEROPS_EXECUTOR_SOURCE_DIRECTORY);
}
