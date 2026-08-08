import { z } from "zod";

export const githubIdSchema = z.number().int().positive().safe();
export const githubShaSchema = z.string().regex(/^[0-9a-f]{40}$/);
export const githubOwnerSchema = z.string().min(1).max(120);
export const githubRepositoryNameSchema = z.string().min(1).max(120);

export const githubRepositorySchema = z.object({
  id: githubIdSchema,
  name: githubRepositoryNameSchema,
  full_name: z.string().min(3).max(241),
  private: z.boolean(),
  default_branch: z.string().min(1).max(255),
  owner: z.object({
    id: githubIdSchema,
    login: githubOwnerSchema,
    type: z.string().min(1).max(40),
  }),
});

export type GitHubRepository = z.infer<typeof githubRepositorySchema>;

export const githubPullRequestSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().min(1).max(10_000),
  body: z.string().nullable(),
  html_url: z.string().url(),
  state: z.enum(["open", "closed"]),
  draft: z.boolean().nullable(),
  base: z.object({ sha: githubShaSchema }),
  head: z.object({ sha: githubShaSchema }),
});

export interface ResolvedPullRequest {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly htmlUrl: string;
  readonly state: "open" | "closed";
  readonly draft: boolean;
  readonly baseSha: string;
  readonly headSha: string;
  readonly diff: string;
}

export const installationWebhookSchema = z.object({
  action: z.enum(["created", "deleted", "suspend", "unsuspend", "new_permissions_accepted"]),
  installation: z.object({
    id: githubIdSchema,
    repository_selection: z.enum(["all", "selected"]),
    suspended_at: z.string().datetime().nullable(),
    account: z.object({
      id: githubIdSchema,
      login: githubOwnerSchema,
      type: z.string().min(1).max(40),
    }),
  }),
  sender: z.object({ id: githubIdSchema, login: githubOwnerSchema }),
});

export const installationRepositoriesWebhookSchema = z.object({
  action: z.enum(["added", "removed"]),
  installation: z.object({ id: githubIdSchema }),
  repositories_added: z.array(githubRepositorySchema),
  repositories_removed: z.array(githubRepositorySchema),
  sender: z.object({ id: githubIdSchema, login: githubOwnerSchema }),
});

export const pullRequestWebhookSchema = z.object({
  action: z.enum([
    "opened",
    "reopened",
    "synchronize",
    "ready_for_review",
    "converted_to_draft",
    "closed",
  ]),
  installation: z.object({ id: githubIdSchema }),
  repository: githubRepositorySchema,
  pull_request: githubPullRequestSchema,
  sender: z.object({ id: githubIdSchema, login: githubOwnerSchema }),
});

export const issueCommentWebhookSchema = z.object({
  action: z.literal("created"),
  installation: z.object({ id: githubIdSchema }),
  repository: githubRepositorySchema,
  issue: z.object({
    number: z.number().int().positive(),
    pull_request: z.object({ url: z.string().url() }).optional(),
  }),
  comment: z.object({
    id: githubIdSchema,
    body: z.string().max(100_000),
    user: z.object({ id: githubIdSchema, login: githubOwnerSchema }),
  }),
  sender: z.object({ id: githubIdSchema, login: githubOwnerSchema }),
});

export const trialRunCommandSchema = z.enum(["analyze", "confirm", "run", "explain", "cancel"]);
export type TrialRunCommand = z.infer<typeof trialRunCommandSchema>;

export function parseTrialRunCommand(body: string): TrialRunCommand | null {
  const normalized = body.trim().toLowerCase();
  const match = /^@trialrun\s+(analyze|confirm|run|explain|cancel)$/.exec(normalized);
  return match?.[1] ? trialRunCommandSchema.parse(match[1]) : null;
}
