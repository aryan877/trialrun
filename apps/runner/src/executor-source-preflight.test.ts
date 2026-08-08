import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertReviewProviderMatchesRunner,
  validateExecutorSourceBundle,
} from "./executor-source-preflight";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "trialrun-executor-preflight-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function createBundle(directory: string): Promise<void> {
  await mkdir(join(directory, "src"), { recursive: true });
  await mkdir(join(directory, "node_modules/.bin"), { recursive: true });
  await mkdir(join(directory, "node_modules/@trialrun/executor"), { recursive: true });
  await writeFile(join(directory, "zerops.yaml"), "zerops:\n  - setup: runner\n");
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      name: "@trialrun/runner",
      dependencies: { "@trialrun/executor": "workspace:*" },
    }),
  );
  await writeFile(join(directory, "src/index.ts"), "export {};\n");
  await writeFile(join(directory, "node_modules/.bin/tsx"), "#!/bin/sh\nexit 0\n");
  await chmod(join(directory, "node_modules/.bin/tsx"), 0o755);
  await writeFile(
    join(directory, "node_modules/@trialrun/executor/package.json"),
    JSON.stringify({ name: "@trialrun/executor", version: "0.1.0" }),
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("validateExecutorSourceBundle", () => {
  it("accepts a self-contained production executor bundle", async () => {
    const directory = await temporaryDirectory();
    await createBundle(directory);

    expect(validateExecutorSourceBundle(directory)).toBe(await realpath(directory));
  });

  it("accepts pnpm-style package and binary symlinks that stay inside the bundle", async () => {
    const directory = await temporaryDirectory();
    await createBundle(directory);
    const tsxTarget = join(directory, "node_modules/.pnpm/tsx/bin/cli.mjs");
    const executorTarget = join(
      directory,
      "node_modules/.pnpm/trialrun-executor/node_modules/@trialrun/executor",
    );
    await mkdir(join(directory, "node_modules/.pnpm/tsx/bin"), { recursive: true });
    await writeFile(tsxTarget, "#!/usr/bin/env node\n");
    await chmod(tsxTarget, 0o755);
    await mkdir(executorTarget, { recursive: true });
    await writeFile(
      join(executorTarget, "package.json"),
      JSON.stringify({ name: "@trialrun/executor", version: "0.1.0" }),
    );
    await rm(join(directory, "node_modules/.bin/tsx"));
    await rm(join(directory, "node_modules/@trialrun/executor"), { recursive: true });
    await symlink("../.pnpm/tsx/bin/cli.mjs", join(directory, "node_modules/.bin/tsx"));
    await symlink(
      "../.pnpm/trialrun-executor/node_modules/@trialrun/executor",
      join(directory, "node_modules/@trialrun/executor"),
    );

    expect(validateExecutorSourceBundle(directory)).toBe(await realpath(directory));
  });

  it("reports a missing runtime entry with one actionable error", async () => {
    const directory = await temporaryDirectory();
    await createBundle(directory);
    await rm(join(directory, "node_modules/.bin/tsx"));
    const canonicalDirectory = await realpath(directory);

    expect(() => validateExecutorSourceBundle(directory)).toThrowError(
      new Error(
        `Executor source preflight failed for "${canonicalDirectory}": node_modules/.bin/tsx is missing. ` +
          "Set TRIALRUN_ZEROPS_EXECUTOR_SOURCE_DIRECTORY to a self-contained production bundle " +
          "containing zerops.yaml, package.json, src/index.ts, executable node_modules/.bin/tsx, " +
          "and the installed @trialrun/executor production dependency.",
      ),
    );
  });

  it("rejects an executor package symlink that escapes the bundle", async () => {
    const directory = await temporaryDirectory();
    const externalDirectory = await temporaryDirectory();
    await createBundle(directory);
    await writeFile(
      join(externalDirectory, "package.json"),
      JSON.stringify({ name: "@trialrun/executor" }),
    );
    await rm(join(directory, "node_modules/@trialrun/executor"), { recursive: true });
    await symlink(externalDirectory, join(directory, "node_modules/@trialrun/executor"));

    expect(() => validateExecutorSourceBundle(directory)).toThrow(
      "node_modules/@trialrun/executor resolves outside the bundle",
    );
  });

  it("rejects a required file reached through a parent symlink outside the bundle", async () => {
    const directory = await temporaryDirectory();
    const externalDirectory = await temporaryDirectory();
    await createBundle(directory);
    await writeFile(join(externalDirectory, "index.ts"), "export {};\n");
    await rm(join(directory, "src"), { recursive: true });
    await symlink(externalDirectory, join(directory, "src"));

    expect(() => validateExecutorSourceBundle(directory)).toThrow(
      "src/index.ts resolves outside the bundle",
    );
  });

  it("requires @trialrun/executor to be a production dependency", async () => {
    const directory = await temporaryDirectory();
    await createBundle(directory);
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({
        name: "@trialrun/runner",
        devDependencies: { "@trialrun/executor": "workspace:*" },
      }),
    );

    expect(() => validateExecutorSourceBundle(directory)).toThrow(
      "package.json must declare @trialrun/executor in dependencies",
    );
  });
});

describe("assertReviewProviderMatchesRunner", () => {
  it("accepts the provider configured for the runner", () => {
    expect(() => assertReviewProviderMatchesRunner("zerops", "zerops")).not.toThrow();
  });

  it("rejects a mismatched provider before provisioning", () => {
    expect(() => assertReviewProviderMatchesRunner("local", "zerops")).toThrow(
      'Review provider "local" does not match runner EXECUTION_PROVIDER "zerops".',
    );
  });
});
