import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { webArtifactSourceDigest } from "./web-artifact-source.js";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const deployRoot = resolve(repoRoot, ".deploy");
const liveArtifact = resolve(deployRoot, "web-linux");

function archiveName(now: Date): string {
  return resolve(deployRoot, `web-linux.previous-${now.toISOString().replaceAll(":", "-")}`);
}

async function main(): Promise<void> {
  await mkdir(deployRoot, { recursive: true });
  const candidate = await mkdtemp(resolve(deployRoot, "web-linux.candidate-"));
  const sourceDigest = await webArtifactSourceDigest(repoRoot);
  let archivedArtifact: string | undefined;

  try {
    await execFileAsync(
      "docker",
      [
        "build",
        "--platform",
        "linux/amd64",
        "--build-arg",
        `TRIALRUN_WEB_SOURCE_DIGEST=${sourceDigest}`,
        "--output",
        `type=local,dest=${candidate}`,
        "-f",
        "ops/web-artifact.Dockerfile",
        ".",
      ],
      { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 },
    );
    await copyFile(
      resolve(repoRoot, "ops/web-artifact.zerops.yaml"),
      resolve(candidate, "zerops.yaml"),
    );
    await execFileAsync("pnpm", ["web:artifact:verify", candidate], {
      cwd: repoRoot,
      maxBuffer: 4 * 1024 * 1024,
    });

    archivedArtifact = archiveName(new Date());
    try {
      await rename(liveArtifact, archivedArtifact);
    } catch (error: unknown) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      archivedArtifact = undefined;
    }

    try {
      await rename(candidate, liveArtifact);
    } catch (error: unknown) {
      if (archivedArtifact) await rename(archivedArtifact, liveArtifact);
      throw error;
    }
  } finally {
    await rm(candidate, { force: true, recursive: true });
  }
  process.stdout.write(`Linux web artifact is ready at ${liveArtifact}.\n`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown Linux artifact build error.";
  process.stderr.write(`Unable to build the Linux web artifact: ${message}\n`);
  process.exitCode = 1;
});
