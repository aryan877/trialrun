import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const deployEnvironmentSchema = z.object({
  ZEROPS_PROJECT_ID: z.string().min(1),
  ZEROPS_WEB_SERVICE_ID: z.string().min(1),
  ZCLI_BINARY: z.string().min(1).optional(),
  TRIALRUN_WEB_ARTIFACT_DIRECTORY: z.string().min(1).optional(),
  TRIALRUN_WEB_VERSION_NAME: z.string().min(1).optional(),
  TRIALRUN_WEB_HEALTH_URL: z.url().optional(),
});

const healthResponseSchema = z.object({ status: z.literal("ready") });

function versionName(now: Date): string {
  return `trialrun-web-${now.toISOString().replaceAll(":", "-")}`;
}

async function waitForHealth(url: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) {
        healthResponseSchema.parse(await response.json());
        return;
      }
      lastError = new Error(`Health endpoint returned HTTP ${response.status}.`);
    } catch (error: unknown) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
  }
  throw new Error("The deployed web service did not become healthy within 60 seconds.", {
    cause: lastError,
  });
}

async function main(): Promise<void> {
  const environment = deployEnvironmentSchema.parse(process.env);
  const artifactDirectory = resolve(
    repoRoot,
    environment.TRIALRUN_WEB_ARTIFACT_DIRECTORY ?? ".deploy/web-linux",
  );
  const zcliBinary =
    environment.ZCLI_BINARY ?? resolve(repoRoot, "apps/runner/node_modules/.bin/zcli");

  await Promise.all([
    access(resolve(artifactDirectory, "apps")),
    access(resolve(artifactDirectory, "node_modules")),
    access(resolve(artifactDirectory, "zerops.yaml")),
    access(zcliBinary),
  ]);

  await execFileAsync("pnpm", ["web:artifact:verify", artifactDirectory], {
    cwd: repoRoot,
    maxBuffer: 4 * 1024 * 1024,
  });

  const { stdout, stderr } = await execFileAsync(
    zcliBinary,
    [
      "service",
      "deploy",
      "--project-id",
      environment.ZEROPS_PROJECT_ID,
      "--service-id",
      environment.ZEROPS_WEB_SERVICE_ID,
      "--setup",
      "web",
      "--working-dir",
      artifactDirectory,
      "--zerops-yaml-path",
      "zerops.yaml",
      "--path-to-file-or-dir",
      "apps",
      "--path-to-file-or-dir",
      "node_modules",
      "--version-name",
      environment.TRIALRUN_WEB_VERSION_NAME ?? versionName(new Date()),
    ],
    { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 },
  );

  process.stdout.write(stdout);
  process.stderr.write(stderr);
  await waitForHealth(
    environment.TRIALRUN_WEB_HEALTH_URL ?? "https://trialrun.aryankumar.dev/api/health",
  );
  process.stdout.write(
    "Zerops deployed the verified Linux web artifact and its health check passed.\n",
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown web artifact deployment error.";
  process.stderr.write(`Unable to deploy the Linux web artifact: ${message}\n`);
  process.exitCode = 1;
});
