import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { RetryableGitHubSourceAccessError, stageGitHubReview } from "./git-source";

const execFileAsync = promisify(execFile);
const pullNumber = 42;
const installationToken = "github-installation-token-for-test";

let root = "";
let stagingParent = "";
let baseSha = "";
let headSha = "";
let gitBinary = "";

async function runGit(workingDirectory: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", [...args], {
    cwd: workingDirectory,
    encoding: "utf8",
  });
  return stdout.trim();
}

beforeAll(async () => {
  gitBinary = (await execFileAsync("/usr/bin/which", ["git"], { encoding: "utf8" })).stdout.trim();
  root = await mkdtemp(join(tmpdir(), "trialrun-github-source-test-"));
  const source = join(root, "source");
  const remote = join(root, "remote.git");
  stagingParent = join(root, "staging");
  await mkdir(source);
  await mkdir(stagingParent);
  await runGit(source, ["init", "--quiet", "--initial-branch=main"]);
  await runGit(source, ["config", "user.email", "git-source-test@trialrun.test"]);
  await runGit(source, ["config", "user.name", "TrialRun Git source test"]);

  await writeFile(join(source, "version.txt"), "base\n", "utf8");
  await runGit(source, ["add", "version.txt"]);
  await runGit(source, ["commit", "--quiet", "-m", "base"]);
  baseSha = await runGit(source, ["rev-parse", "HEAD"]);

  await runGit(source, ["switch", "--quiet", "-c", "feature"]);
  await writeFile(join(source, "version.txt"), "pull request head\n", "utf8");
  await runGit(source, ["commit", "--quiet", "-am", "pull request head"]);
  headSha = await runGit(source, ["rev-parse", "HEAD"]);

  await runGit(source, ["switch", "--quiet", "main"]);
  await writeFile(join(source, "version.txt"), "main moved after review base\n", "utf8");
  await runGit(source, ["commit", "--quiet", "-am", "advance main"]);

  await runGit(root, ["clone", "--quiet", "--bare", source, remote]);
  await runGit(remote, ["update-ref", `refs/pull/${pullNumber}/head`, headSha]);
  await runGit(remote, ["update-ref", "-d", "refs/heads/feature"]);

  const gitConfigPath = join(root, "gitconfig");
  await writeFile(
    gitConfigPath,
    `[url "${pathToFileURL(remote).href}"]
  insteadOf = https://github.com/trialrun/example.git
[protocol "file"]
  allow = always
`,
    "utf8",
  );
  vi.stubEnv("GIT_CONFIG_GLOBAL", gitConfigPath);
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  if (root) await rm(root, { recursive: true, force: true });
});

describe("GitHub review source staging", () => {
  it("fetches the pull head ref, verifies its SHA, and keeps base pinned", async () => {
    const staged = await stageGitHubReview({
      owner: "trialrun",
      repository: "example",
      installationToken,
      pullNumber,
      baseSha,
      headSha,
      stagingParent,
    });
    try {
      expect(staged.sourceWorkspaces.base.sha).toBe(baseSha);
      expect(staged.sourceWorkspaces.head.sha).toBe(headSha);
      expect(
        await readFile(join(staged.sourceWorkspaces.base.directory, "version.txt"), "utf8"),
      ).toBe("base\n");
      expect(
        await readFile(join(staged.sourceWorkspaces.head.directory, "version.txt"), "utf8"),
      ).toBe("pull request head\n");
      expect(
        await readFile(join(staged.sourceWorkspaces.head.directory, ".git", "FETCH_HEAD"), "utf8"),
      ).toContain(`refs/pull/${pullNumber}/head`);
    } finally {
      await staged.cleanup();
    }
  });

  it("rejects a pull ref that does not resolve to the expected head SHA", async () => {
    await expect(
      stageGitHubReview({
        owner: "trialrun",
        repository: "example",
        installationToken,
        pullNumber,
        baseSha,
        headSha: "f".repeat(40),
        stagingParent,
      }),
    ).rejects.toThrow("head checkout did not match its requested SHA");
    expect(await readdir(stagingParent)).toEqual([]);
  });

  it("rejects an invalid pull request number before staging", async () => {
    await expect(
      stageGitHubReview({
        owner: "trialrun",
        repository: "example",
        installationToken,
        pullNumber: 0,
        baseSha,
        headSha,
        stagingParent,
      }),
    ).rejects.toThrow();
    expect(await readdir(stagingParent)).toEqual([]);
  });

  it("classifies GitHub's exact private-repository visibility failure and removes staging", async () => {
    const fakeBin = join(root, "fake-bin");
    const fakeGit = join(fakeBin, "git");
    await mkdir(fakeBin);
    await writeFile(
      fakeGit,
      `#!/bin/sh
if [ "$1" = "fetch" ]; then
  printf '%s\n' 'remote: Repository not found.' >&2
  exit 128
fi
exec '${gitBinary}' "$@"
`,
      { encoding: "utf8", mode: 0o700 },
    );
    await chmod(fakeGit, 0o700);
    const originalPath = process.env.PATH;
    process.env.PATH = `${fakeBin}:${originalPath ?? ""}`;
    try {
      const error = await stageGitHubReview({
        owner: "trialrun",
        repository: "example",
        installationToken,
        pullNumber,
        baseSha,
        headSha,
        stagingParent,
      }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(RetryableGitHubSourceAccessError);
      expect(String(error)).not.toContain(installationToken);
      expect(await readdir(stagingParent)).toEqual([]);
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
