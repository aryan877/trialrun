import { App } from "octokit";
import { z } from "zod";

import {
  githubPullRequestSchema,
  githubRepositorySchema,
  type GitHubRepository,
  type ResolvedPullRequest,
} from "./types";

const installationAuthenticationSchema = z.object({
  type: z.literal("token"),
  tokenType: z.literal("installation"),
  token: z.string().min(20).max(2_000),
  installationId: z.number().int().positive().safe(),
  expiresAt: z.string().datetime(),
});

const permissionSchema = z.object({ permission: z.enum(["admin", "maintain", "write", "triage", "read", "none"]) });
const githubUserSchema = z.object({
  id: z.number().int().positive().safe(),
  login: z.string().min(1).max(100),
  avatar_url: z.string().url(),
});
const userInstallationSchema = z.object({
  id: z.number().int().positive().safe(),
  app_id: z.number().int().positive().safe(),
  repository_selection: z.enum(["all", "selected"]),
  suspended_at: z.string().datetime().nullable(),
  account: z.object({
    id: z.number().int().positive().safe(),
    login: z.string().min(1).max(120),
    type: z.string().min(1).max(40),
  }),
});
const branchSchema = z.object({ commit: z.object({ sha: z.string().regex(/^[0-9a-f]{40}$/) }) });

export interface GitHubAppOptions {
  readonly appId: number;
  readonly privateKey: string;
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly webhookSecret?: string;
}

export interface AuthorizedInstallation {
  readonly githubUser: {
    readonly id: number;
    readonly login: string;
    readonly avatarUrl: string;
  };
  readonly installation: {
    readonly id: number;
    readonly accountId: number;
    readonly accountLogin: string;
    readonly accountType: string;
    readonly repositorySelection: "all" | "selected";
    readonly suspendedAt: string | null;
  };
}

export interface CheckRunInput {
  readonly owner: string;
  readonly repository: string;
  readonly headSha: string;
  readonly detailsUrl?: string;
  readonly title: string;
  readonly summary: string;
  readonly text?: string;
}

export interface CheckRunCompletionInput extends CheckRunInput {
  readonly checkRunId: number;
  readonly conclusion: "success" | "failure" | "neutral" | "cancelled" | "timed_out" | "action_required";
}

export class GitHubAppService {
  readonly #app: InstanceType<typeof App>;
  readonly #appId: number;
  readonly #hasOAuth: boolean;

  constructor(options: GitHubAppOptions) {
    const appId = z.number().int().positive().safe().parse(options.appId);
    const privateKey = z.string().includes("BEGIN").min(100).parse(options.privateKey);
    const hasClientId = Boolean(options.clientId);
    const hasClientSecret = Boolean(options.clientSecret);
    if (hasClientId !== hasClientSecret) {
      throw new Error("GitHub OAuth client ID and secret must be configured together.");
    }
    this.#appId = appId;
    this.#hasOAuth = hasClientId && hasClientSecret;
    this.#app = new App({
      appId,
      privateKey,
      ...(options.webhookSecret ? { webhooks: { secret: options.webhookSecret } } : {}),
      ...(options.clientId && options.clientSecret
        ? { oauth: { clientId: options.clientId, clientSecret: options.clientSecret } }
        : {}),
    });
  }

  async installationUrl(state: string): Promise<string> {
    return this.#app.getInstallationUrl({ state: z.string().min(20).max(4_000).parse(state) });
  }

  async authorizeInstallation(input: {
    readonly code: string;
    readonly state: string;
    readonly installationId: number;
  }): Promise<AuthorizedInstallation> {
    if (!this.#hasOAuth) throw new Error("GitHub user authorization is not configured.");
    const code = z.string().min(10).max(1_000).parse(input.code);
    const state = z.string().min(20).max(4_000).parse(input.state);
    const installationId = z.number().int().positive().safe().parse(input.installationId);
    const authorization = await this.#app.oauth.createToken({ code, state });
    const userOctokit = await this.#app.oauth.getUserOctokit({
      token: authorization.authentication.token,
    });
    try {
      const user = githubUserSchema.parse((await userOctokit.rest.users.getAuthenticated()).data);
      const installations = z.array(userInstallationSchema).parse(
        await userOctokit.paginate(
          userOctokit.rest.apps.listInstallationsForAuthenticatedUser,
          { per_page: 100 },
        ),
      );
      const installation = installations.find(
        (candidate) => candidate.id === installationId && candidate.app_id === this.#appId,
      );
      if (!installation) {
        throw new Error("The authorized GitHub user cannot access this TrialRun installation.");
      }
      return {
        githubUser: { id: user.id, login: user.login, avatarUrl: user.avatar_url },
        installation: {
          id: installation.id,
          accountId: installation.account.id,
          accountLogin: installation.account.login,
          accountType: installation.account.type,
          repositorySelection: installation.repository_selection,
          suspendedAt: installation.suspended_at,
        },
      };
    } finally {
      await this.#app.oauth.deleteToken({ token: authorization.authentication.token });
    }
  }

  async #client(installationId: number) {
    return this.#app.getInstallationOctokit(z.number().int().positive().safe().parse(installationId));
  }

  async getInstallationToken(
    installationId: number,
    repositoryId: number,
  ): Promise<{ readonly token: string; readonly expiresAt: string }> {
    const client = await this.#client(installationId);
    const authentication = installationAuthenticationSchema.parse(
      await client.auth({
        type: "installation",
        repositoryIds: [z.number().int().positive().safe().parse(repositoryId)],
      }),
    );
    return { token: authentication.token, expiresAt: authentication.expiresAt };
  }

  async listInstallationRepositories(installationId: number): Promise<readonly GitHubRepository[]> {
    const client = await this.#client(installationId);
    const repositories = await client.paginate(client.rest.apps.listReposAccessibleToInstallation, {
      per_page: 100,
    });
    return z.array(githubRepositorySchema).parse(repositories);
  }

  async resolvePullRequest(input: {
    readonly installationId: number;
    readonly owner: string;
    readonly repository: string;
    readonly pullNumber: number;
  }): Promise<ResolvedPullRequest> {
    const client = await this.#client(input.installationId);
    const parameters = {
      owner: input.owner,
      repo: input.repository,
      pull_number: input.pullNumber,
    } as const;
    const response = await client.rest.pulls.get(parameters);
    const pullRequest = githubPullRequestSchema.parse(response.data);
    const diffResponse = await client.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
      ...parameters,
      headers: { accept: "application/vnd.github.v3.diff" },
    });
    if (typeof diffResponse.data !== "string") {
      throw new Error("GitHub did not return the pull request diff as text.");
    }
    if (Buffer.byteLength(diffResponse.data, "utf8") > 1_000_000) {
      throw new Error("Pull request diff exceeds the TrialRun planning limit.");
    }
    return {
      number: pullRequest.number,
      title: pullRequest.title,
      body: pullRequest.body ?? "",
      htmlUrl: pullRequest.html_url,
      state: pullRequest.state,
      draft: pullRequest.draft ?? false,
      baseSha: pullRequest.base.sha,
      headSha: pullRequest.head.sha,
      diff: diffResponse.data,
    };
  }

  async resolveBranchSha(input: {
    readonly installationId: number;
    readonly owner: string;
    readonly repository: string;
    readonly branch: string;
  }): Promise<string> {
    const client = await this.#client(input.installationId);
    const response = await client.rest.repos.getBranch({
      owner: input.owner,
      repo: input.repository,
      branch: z.string().min(1).max(255).parse(input.branch),
    });
    return branchSchema.parse(response.data).commit.sha;
  }

  async createQueuedCheck(
    installationId: number,
    input: CheckRunInput,
  ): Promise<number> {
    const client = await this.#client(installationId);
    const response = await client.rest.checks.create({
      owner: input.owner,
      repo: input.repository,
      name: "TrialRun behavioral review",
      head_sha: input.headSha,
      status: "queued",
      ...(input.detailsUrl ? { details_url: input.detailsUrl } : {}),
      output: { title: input.title.slice(0, 255), summary: input.summary.slice(0, 65_535) },
    });
    return z.number().int().positive().safe().parse(response.data.id);
  }

  async markCheckInProgress(
    installationId: number,
    input: CheckRunInput & { readonly checkRunId: number },
  ): Promise<void> {
    const client = await this.#client(installationId);
    await client.rest.checks.update({
      owner: input.owner,
      repo: input.repository,
      check_run_id: input.checkRunId,
      name: "TrialRun behavioral review",
      status: "in_progress",
      started_at: new Date().toISOString(),
      ...(input.detailsUrl ? { details_url: input.detailsUrl } : {}),
      output: { title: input.title.slice(0, 255), summary: input.summary.slice(0, 65_535) },
    });
  }

  async completeCheck(installationId: number, input: CheckRunCompletionInput): Promise<void> {
    const client = await this.#client(installationId);
    await client.rest.checks.update({
      owner: input.owner,
      repo: input.repository,
      check_run_id: input.checkRunId,
      name: "TrialRun behavioral review",
      status: "completed",
      conclusion: input.conclusion,
      completed_at: new Date().toISOString(),
      ...(input.detailsUrl ? { details_url: input.detailsUrl } : {}),
      output: {
        title: input.title.slice(0, 255),
        summary: input.summary.slice(0, 65_535),
        ...(input.text ? { text: input.text.slice(0, 65_535) } : {}),
      },
    });
  }

  async createPullRequestComment(
    installationId: number,
    input: { readonly owner: string; readonly repository: string; readonly pullNumber: number; readonly body: string },
  ): Promise<number> {
    const client = await this.#client(installationId);
    const response = await client.rest.issues.createComment({
      owner: input.owner,
      repo: input.repository,
      issue_number: input.pullNumber,
      body: input.body.slice(0, 65_535),
    });
    return z.number().int().positive().safe().parse(response.data.id);
  }

  async repositoryPermission(
    installationId: number,
    input: { readonly owner: string; readonly repository: string; readonly username: string },
  ): Promise<"admin" | "maintain" | "write" | "triage" | "read" | "none"> {
    const client = await this.#client(installationId);
    const response = await client.rest.repos.getCollaboratorPermissionLevel({
      owner: input.owner,
      repo: input.repository,
      username: input.username,
    });
    return permissionSchema.parse(response.data).permission;
  }
}
