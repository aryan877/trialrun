import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const ignoredDirectories = new Set([
  ".cache",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "test-results",
]);

const sourceInputs = [
  ".dockerignore",
  "apps/cloud-executor/package.json",
  "apps/runner/package.json",
  "apps/web",
  "ops/web-artifact.Dockerfile",
  "ops/web-artifact.zerops.yaml",
  "package.json",
  "packages/db",
  "packages/domain",
  "packages/github",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
] as const;

export const webArtifactSourceStamp = ".trialrun-source-sha256";

function excludedFile(name: string): boolean {
  return (
    name === "next-env.d.ts" ||
    name.endsWith(".log") ||
    name.endsWith(".md") ||
    name.endsWith(".tsbuildinfo") ||
    name.startsWith(".env")
  );
}

async function sourceFiles(root: string, input: string): Promise<string[]> {
  const absolute = resolve(root, input);
  const entries = await readdir(absolute, { withFileTypes: true }).catch(() => null);
  if (entries === null) return [absolute];

  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    if (entry.isFile() && excludedFile(entry.name)) continue;
    const path = join(absolute, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(root, relative(root, path))));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

export async function webArtifactSourceDigest(root: string): Promise<string> {
  const files = (await Promise.all(sourceInputs.map((input) => sourceFiles(root, input))))
    .flat()
    .sort();
  const digest = createHash("sha256");
  for (const file of files) {
    digest.update(relative(root, file).split(sep).join("/"));
    digest.update("\0");
    digest.update(await readFile(file));
    digest.update("\0");
  }
  return digest.digest("hex");
}
