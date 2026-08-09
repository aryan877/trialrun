import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { redactText } from "@trialrun/domain";
import { z } from "zod";

import type { ReviewSide, SourceWorkspace } from "./types";

const shaSchema = z.string().regex(/^[0-9a-f]{40}$/);
const pullNumberSchema = z.number().int().positive().safe();

class GitCommandError extends Error {
  readonly githubRepositoryNotFound: boolean;

  constructor(message: string, githubRepositoryNotFound: boolean) {
    super(message);
    this.name = "GitCommandError";
    this.githubRepositoryNotFound = githubRepositoryNotFound;
  }
}

export class RetryableGitHubSourceAccessError extends Error {
  constructor() {
    super("GitHub temporarily reported that the installed private repository was unavailable.");
    this.name = "RetryableGitHubSourceAccessError";
  }
}

async function runGit(
  args: readonly string[],
  workingDirectory?: string,
  options: {
    readonly environment?: NodeJS.ProcessEnv;
    readonly redactionValues?: readonly string[];
  } = {},
): Promise<string> {
  return new Promise((resolveOutput, rejectOutput) => {
    const child = spawn("git", [...args], {
      ...(workingDirectory ? { cwd: workingDirectory } : {}),
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...options.environment },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = `${stdout}${chunk.toString("utf8")}`.slice(-20_000);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-20_000);
    });
    child.once("error", rejectOutput);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveOutput(stdout.trim());
      else {
        const safeError = redactText(stderr, options.redactionValues ?? []);
        rejectOutput(
          new GitCommandError(
            `git ${args[0] ?? "command"} exited with ${code ?? signal}: ${safeError}`,
            safeError
              .split(/\r?\n/u)
              .some((line) => line.trim() === "remote: Repository not found."),
          ),
        );
      }
    });
  });
}

export interface StagedGitReview {
  readonly sourceWorkspaces: Readonly<Record<ReviewSide, SourceWorkspace>>;
  cleanup(): Promise<void>;
}

export async function stageLocalGitReview(input: {
  readonly repositoryDirectory: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly stagingParent?: string;
}): Promise<StagedGitReview> {
  const baseSha = shaSchema.parse(input.baseSha);
  const headSha = shaSchema.parse(input.headSha);
  if (baseSha === headSha) throw new Error("Base and head must be different commits.");
  const repositoryDirectory = await realpath(resolve(input.repositoryDirectory));
  if (!(await stat(repositoryDirectory)).isDirectory())
    throw new Error("Repository source is not a directory.");
  for (const sha of [baseSha, headSha]) {
    const resolvedSha = await runGit(
      ["rev-parse", "--verify", `${sha}^{commit}`],
      repositoryDirectory,
    );
    if (resolvedSha !== sha)
      throw new Error(`Git did not resolve the exact requested commit ${sha}.`);
  }

  const root = await mkdtemp(
    input.stagingParent
      ? join(resolve(input.stagingParent), ".trialrun-stage-")
      : join(tmpdir(), "trialrun-stage-"),
  );
  const sourceWorkspaces = {} as Record<ReviewSide, SourceWorkspace>;
  try {
    for (const [side, sha] of [
      ["base", baseSha],
      ["head", headSha],
    ] as const) {
      const directory = join(root, side);
      await runGit([
        "clone",
        "--local",
        "--no-hardlinks",
        "--no-checkout",
        repositoryDirectory,
        directory,
      ]);
      await runGit(["checkout", "--detach", sha], directory);
      const checkedOut = await runGit(["rev-parse", "HEAD"], directory);
      if (checkedOut !== sha) throw new Error(`${side} checkout did not match its requested SHA.`);
      sourceWorkspaces[side] = { sha, directory };
    }
    return {
      sourceWorkspaces,
      cleanup: () => rm(root, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

const githubOwnerSchema = z
  .string()
  .min(1)
  .max(39)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/);
const githubRepositorySchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+$/)
  .refine((value) => value !== "." && value !== "..", "Invalid GitHub repository name.");

export async function stageGitHubReview(input: {
  readonly owner: string;
  readonly repository: string;
  readonly installationToken: string;
  readonly pullNumber: number;
  readonly baseSha: string;
  readonly headSha: string;
  readonly stagingParent?: string;
}): Promise<StagedGitReview> {
  const baseSha = shaSchema.parse(input.baseSha);
  const headSha = shaSchema.parse(input.headSha);
  const pullNumber = pullNumberSchema.parse(input.pullNumber);
  if (baseSha === headSha) throw new Error("Base and head must be different commits.");
  const staged = await stageGitHubSources(input, [
    { name: "base", fetchRevision: baseSha, expectedSha: baseSha },
    {
      name: "head",
      fetchRevision: `refs/pull/${pullNumber}/head`,
      expectedSha: headSha,
    },
  ]);
  const base = staged.workspaces.base;
  const head = staged.workspaces.head;
  if (!base || !head) {
    await staged.cleanup();
    throw new Error("GitHub review staging did not produce both source workspaces.");
  }
  return { sourceWorkspaces: { base, head }, cleanup: () => staged.cleanup() };
}

export interface StagedGitCommit {
  readonly workspace: SourceWorkspace;
  cleanup(): Promise<void>;
}

export async function stageGitHubCommit(input: {
  readonly owner: string;
  readonly repository: string;
  readonly installationToken: string;
  readonly sha: string;
  readonly stagingParent?: string;
}): Promise<StagedGitCommit> {
  const sha = shaSchema.parse(input.sha);
  const staged = await stageGitHubSources(input, [
    { name: "source", fetchRevision: sha, expectedSha: sha },
  ]);
  const workspace = staged.workspaces.source;
  if (!workspace) {
    await staged.cleanup();
    throw new Error("GitHub commit staging did not produce a source workspace.");
  }
  return { workspace, cleanup: () => staged.cleanup() };
}

async function stageGitHubSources(
  input: {
    readonly owner: string;
    readonly repository: string;
    readonly installationToken: string;
    readonly stagingParent?: string;
  },
  revisions: readonly {
    readonly name: string;
    readonly fetchRevision: string;
    readonly expectedSha: string;
  }[],
): Promise<{
  readonly workspaces: Readonly<Record<string, SourceWorkspace>>;
  cleanup(): Promise<void>;
}> {
  const owner = githubOwnerSchema.parse(input.owner);
  const repository = githubRepositorySchema.parse(input.repository);
  const installationToken = z.string().min(20).max(2_000).parse(input.installationToken);

  const root = await mkdtemp(
    input.stagingParent
      ? join(resolve(input.stagingParent), ".trialrun-stage-")
      : join(tmpdir(), "trialrun-stage-"),
  );
  const askpassPath = join(root, "github-askpass.sh");
  const remoteUrl = `https://github.com/${owner}/${repository}.git`;
  const gitEnvironment: NodeJS.ProcessEnv = {
    GIT_ASKPASS: askpassPath,
    GIT_ASKPASS_REQUIRE: "force",
    TRIALRUN_GIT_INSTALLATION_TOKEN: installationToken,
  };
  const gitOptions = { environment: gitEnvironment, redactionValues: [installationToken] } as const;
  const workspaces: Record<string, SourceWorkspace> = {};

  try {
    await writeFile(
      askpassPath,
      `#!/bin/sh
case "$1" in
  *Username*) printf '%s\\n' 'x-access-token' ;;
  *Password*) printf '%s\\n' "$TRIALRUN_GIT_INSTALLATION_TOKEN" ;;
  *) exit 1 ;;
esac
`,
      { encoding: "utf8", mode: 0o700 },
    );
    await chmod(askpassPath, 0o700);

    for (const { name, fetchRevision, expectedSha } of revisions) {
      const sha = shaSchema.parse(expectedSha);
      const directory = join(root, name);
      await mkdir(directory, { recursive: false });
      await runGit(["init", "--quiet"], directory, gitOptions);
      await runGit(["remote", "add", "origin", remoteUrl], directory, gitOptions);
      try {
        await runGit(
          ["fetch", "--quiet", "--no-tags", "--depth=1", "origin", fetchRevision],
          directory,
          gitOptions,
        );
      } catch (error) {
        if (error instanceof GitCommandError && error.githubRepositoryNotFound) {
          throw new RetryableGitHubSourceAccessError();
        }
        throw error;
      }
      await runGit(["checkout", "--quiet", "--detach", "FETCH_HEAD"], directory, gitOptions);
      const checkedOut = await runGit(["rev-parse", "HEAD"], directory, gitOptions);
      if (checkedOut !== sha) throw new Error(`${name} checkout did not match its requested SHA.`);
      workspaces[name] = { sha, directory };
    }

    await rm(askpassPath, { force: true });
    return {
      workspaces,
      cleanup: () => rm(root, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
