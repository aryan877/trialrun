import { cp, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const deployRoot = resolve(repositoryRoot, ".deploy");
const outputDirectory = resolve(deployRoot, "codex-workspace-source");

async function main(): Promise<void> {
  await mkdir(deployRoot, { recursive: true });
  const candidate = await mkdtemp(resolve(deployRoot, "codex-workspace-source.candidate-"));
  try {
    await mkdir(join(candidate, "dist"), { recursive: true });
    await build({
      entryPoints: [resolve(packageRoot, "src/index.ts")],
      outfile: join(candidate, "dist/index.js"),
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node24",
      sourcemap: false,
      legalComments: "none",
      logLevel: "warning",
    });
    await cp(
      resolve(repositoryRoot, "ops/codex-workspace-bundle.zerops.yaml"),
      join(candidate, "zerops.yaml"),
    );
    await rm(outputDirectory, { recursive: true, force: true });
    await rename(candidate, outputDirectory);
    process.stdout.write(`Codex workspace source is ready at ${outputDirectory}.\n`);
  } catch (error) {
    await rm(candidate, { recursive: true, force: true });
    throw error;
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown workspace artifact error.";
  process.stderr.write(`Unable to build the Codex workspace artifact: ${message}\n`);
  process.exitCode = 1;
});
