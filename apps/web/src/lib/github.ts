import "server-only";

import { GitHubAppService } from "@trialrun/github";

import { serverEnv } from "./env";

let cached: GitHubAppService | undefined;

export function githubApp(): GitHubAppService {
  const env = serverEnv();
  if (
    !env.GITHUB_APP_ID ||
    !env.GITHUB_PRIVATE_KEY_BASE64 ||
    !env.GITHUB_CLIENT_ID ||
    !env.GITHUB_CLIENT_SECRET
  ) {
    throw new Error("TrialRun GitHub App credentials are not configured.");
  }
  cached ??= new GitHubAppService({
    appId: env.GITHUB_APP_ID,
    privateKey: Buffer.from(env.GITHUB_PRIVATE_KEY_BASE64, "base64").toString("utf8"),
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
    ...(env.GITHUB_WEBHOOK_SECRET ? { webhookSecret: env.GITHUB_WEBHOOK_SECRET } : {}),
  });
  return cached;
}

export function githubConfigured(): boolean {
  const env = serverEnv();
  return Boolean(
    env.GITHUB_APP_ID &&
      env.GITHUB_PRIVATE_KEY_BASE64 &&
      env.GITHUB_CLIENT_ID &&
      env.GITHUB_CLIENT_SECRET,
  );
}
