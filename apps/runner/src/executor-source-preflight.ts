import { constants, accessSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

import { z } from "zod";

type ExecutionProviderName = "local" | "zerops";

const runnerManifestSchema = z.object({
  dependencies: z.object({
    "@trialrun/executor": z.string().min(1),
  }),
});

const executorManifestSchema = z.object({
  name: z.literal("@trialrun/executor"),
});

function fail(directory: string, problem: string): never {
  throw new Error(
    `Executor source preflight failed for "${directory}": ${problem}. ` +
      "Set TRIALRUN_ZEROPS_EXECUTOR_SOURCE_DIRECTORY to a self-contained production bundle " +
      "containing zerops.yaml, package.json, src/index.ts, executable node_modules/.bin/tsx, " +
      "and the installed @trialrun/executor production dependency.",
  );
}

function existingEntry(directory: string, relativePath: string): string {
  const path = join(directory, relativePath);
  try {
    lstatSync(path);
  } catch {
    fail(directory, `${relativePath} is missing`);
  }
  return path;
}

function isInside(directory: string, path: string): boolean {
  const pathFromDirectory = relative(directory, path);
  return (
    pathFromDirectory === "" ||
    (pathFromDirectory !== ".." &&
      !pathFromDirectory.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromDirectory))
  );
}

function regularFile(directory: string, relativePath: string): string {
  const path = existingEntry(directory, relativePath);
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    fail(directory, `${relativePath} must be a regular file inside the bundle`);
  }
  const canonicalPath = realpathSync(path);
  if (!isInside(directory, canonicalPath)) {
    fail(directory, `${relativePath} resolves outside the bundle`);
  }
  return canonicalPath;
}

function containedEntry(directory: string, relativePath: string): string {
  const path = existingEntry(directory, relativePath);
  let canonicalPath: string;
  try {
    canonicalPath = realpathSync(path);
  } catch {
    fail(directory, `${relativePath} does not resolve to a real bundle entry`);
  }
  if (!isInside(directory, canonicalPath)) {
    fail(directory, `${relativePath} resolves outside the bundle`);
  }
  return canonicalPath;
}

function jsonDocument(directory: string, relativePath: string): unknown {
  const path = regularFile(directory, relativePath);
  try {
    const document: unknown = JSON.parse(readFileSync(path, "utf8"));
    return document;
  } catch {
    fail(directory, `${relativePath} must contain valid JSON`);
  }
}

export function validateExecutorSourceBundle(configuredDirectory: string): string {
  let configuredMetadata: ReturnType<typeof lstatSync>;
  try {
    configuredMetadata = lstatSync(configuredDirectory);
  } catch {
    fail(configuredDirectory, "the configured directory does not exist");
  }
  if (configuredMetadata.isSymbolicLink() || !configuredMetadata.isDirectory()) {
    fail(configuredDirectory, "the configured path must be a real directory, not a symlink");
  }

  const directory = realpathSync(configuredDirectory);
  regularFile(directory, "zerops.yaml");
  regularFile(directory, "src/index.ts");

  const runnerManifest = runnerManifestSchema.safeParse(jsonDocument(directory, "package.json"));
  if (!runnerManifest.success) {
    fail(directory, "package.json must declare @trialrun/executor in dependencies");
  }

  const tsxPath = containedEntry(directory, "node_modules/.bin/tsx");
  if (!statSync(tsxPath).isFile()) {
    fail(directory, "node_modules/.bin/tsx must resolve to a file inside the bundle");
  }
  try {
    accessSync(tsxPath, constants.X_OK);
  } catch {
    fail(directory, "node_modules/.bin/tsx must be executable");
  }

  const executorDirectory = containedEntry(directory, "node_modules/@trialrun/executor");
  if (!statSync(executorDirectory).isDirectory()) {
    fail(directory, "node_modules/@trialrun/executor must resolve to a directory inside the bundle");
  }
  const manifestPathFromBundle = relative(
    directory,
    join(executorDirectory, "package.json"),
  );
  const executorManifest = executorManifestSchema.safeParse(
    jsonDocument(directory, manifestPathFromBundle),
  );
  if (!executorManifest.success) {
    fail(
      directory,
      "node_modules/@trialrun/executor/package.json must identify @trialrun/executor",
    );
  }

  return directory;
}

export function assertReviewProviderMatchesRunner(
  reviewProvider: ExecutionProviderName,
  configuredProvider: ExecutionProviderName,
): void {
  if (reviewProvider !== configuredProvider) {
    throw new Error(
      `Review provider "${reviewProvider}" does not match runner EXECUTION_PROVIDER ` +
        `"${configuredProvider}". Requeue the review for the configured provider before provisioning.`,
    );
  }
}
