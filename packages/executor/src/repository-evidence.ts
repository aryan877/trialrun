import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import { isAllowedRepositoryEvidencePath } from "@trialrun/domain";

export interface RepositoryEvidenceFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly content: string;
}

export interface RepositoryEvidenceBundle {
  readonly root: string;
  readonly files: readonly RepositoryEvidenceFile[];
  readonly totalBytes: number;
}

export interface RepositoryEvidenceLimits {
  readonly maxDepth?: number;
  readonly maxFiles?: number;
  readonly maxFileBytes?: number;
  readonly maxTotalBytes?: number;
}

const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "vendor",
]);

function normalizedRelativePath(root: string, path: string): string {
  const value = relative(root, path).split(sep).join("/");
  if (!value || value.startsWith("../") || value === "..") {
    throw new Error("Repository evidence path escaped the staged checkout.");
  }
  return value;
}

export async function collectRepositoryEvidence(
  repositoryDirectory: string,
  limits: RepositoryEvidenceLimits = {},
): Promise<RepositoryEvidenceBundle> {
  const root = await realpath(resolve(repositoryDirectory));
  const maxDepth = limits.maxDepth ?? 5;
  const maxFiles = limits.maxFiles ?? 80;
  const maxFileBytes = limits.maxFileBytes ?? 256_000;
  const maxTotalBytes = limits.maxTotalBytes ?? 1_500_000;
  const candidatePaths: string[] = [];

  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > maxDepth) return;
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) continue;
      if (metadata.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) await visit(path, depth + 1);
        continue;
      }
      if (!metadata.isFile()) continue;
      const evidencePath = normalizedRelativePath(root, path);
      if (isAllowedRepositoryEvidencePath(evidencePath)) candidatePaths.push(path);
      if (candidatePaths.length > maxFiles) {
        throw new Error(`Repository exposes more than ${maxFiles} allowed evidence files.`);
      }
    }
  };
  await visit(root, 0);

  const files: RepositoryEvidenceFile[] = [];
  let totalBytes = 0;
  for (const path of candidatePaths) {
    const contents = await readFile(path);
    if (contents.byteLength > maxFileBytes) {
      throw new Error(`${normalizedRelativePath(root, path)} exceeds the evidence file limit.`);
    }
    if (!isUtf8(contents) || contents.includes(0)) {
      throw new Error(`${normalizedRelativePath(root, path)} is not safe UTF-8 text evidence.`);
    }
    totalBytes += contents.byteLength;
    if (totalBytes > maxTotalBytes) {
      throw new Error(`Repository evidence exceeds the ${maxTotalBytes}-byte total limit.`);
    }
    files.push({
      path: normalizedRelativePath(root, path),
      bytes: contents.byteLength,
      sha256: createHash("sha256").update(contents).digest("hex"),
      content: contents.toString("utf8"),
    });
  }
  if (!files.some(({ path }) => path === "zerops.yaml" || path === "zerops.yml")) {
    throw new Error("TrialRun requires a root zerops.yaml or zerops.yml in the first release.");
  }
  return { root, files, totalBytes };
}
