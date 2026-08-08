import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { webArtifactSourceDigest, webArtifactSourceStamp } from "./web-artifact-source.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(repoRoot, process.argv[2] ?? ".deploy/web-linux");

function fail(...reasons: string[]): never {
  console.error(`web artifact verification failed: ${target}`);
  for (const reason of reasons) {
    console.error(`  - ${reason}`);
  }
  process.exit(1);
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function collectArgon2Bindings(): Promise<string[]> {
  const bindings: string[] = [];
  async function walk(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && /^argon2\..*\.node$/.test(entry.name)) {
        bindings.push(fullPath);
      }
    }
  }
  await walk(join(target, "node_modules"));
  return bindings;
}

async function main(): Promise<void> {
  const problems: string[] = [];

  if (!(await isFile(join(target, "apps/web/server.js")))) {
    problems.push("apps/web/server.js is missing; the Zerops start command cannot boot it.");
  }
  if (!(await isDirectory(join(target, "apps/web/.next/static")))) {
    problems.push("apps/web/.next/static is missing.");
  }
  if (!(await isDirectory(join(target, "apps/web/public")))) {
    problems.push("apps/web/public is missing.");
  }
  if (!(await isFile(join(target, "zerops.yaml")))) {
    problems.push(
      "zerops.yaml is missing; the artifact cannot be deployed as a self-contained service.",
    );
  }

  const expectedSourceDigest = await webArtifactSourceDigest(repoRoot);
  const sourceStampPath = join(target, webArtifactSourceStamp);
  if (!(await isFile(sourceStampPath))) {
    problems.push(`${webArtifactSourceStamp} is missing; artifact freshness cannot be proved.`);
  } else if ((await readFile(sourceStampPath, "utf8")).trim() !== expectedSourceDigest) {
    problems.push("the artifact was built from different source; rebuild it before deployment.");
  }

  const bindings = await collectArgon2Bindings();
  if (bindings.length === 0) {
    problems.push("no @node-rs/argon2 native binding was exported.");
  } else {
    if (!bindings.some((binding) => binding.includes("linux"))) {
      problems.push("the exported artifact has no Linux argon2 native binding.");
    }
    const darwinBindings = bindings.filter((binding) => binding.includes("darwin"));
    if (darwinBindings.length > 0) {
      problems.push(
        `the exported artifact contains a Darwin argon2 native binding: ${darwinBindings
          .map((binding) => binding.slice(target.length + 1))
          .join(", ")}`,
      );
    }
  }

  if (problems.length > 0) {
    fail(...problems);
  }

  for (const binding of bindings.filter((binding) => binding.includes("linux"))) {
    console.log(`verified linux argon2 binding: ${binding.slice(target.length + 1)}`);
  }
  console.log(`web artifact verification passed: ${target}`);
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown web artifact verification error.";
  process.stderr.write(`Unable to verify the web artifact: ${message}\n`);
  process.exitCode = 1;
});
