import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { safeRelativePathSchema, type CompiledDeploymentTarget } from "@trialrun/domain";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

const MAX_MANIFEST_BYTES = 256_000;

const mutableRecordSchema = z.record(z.string(), z.unknown());
const manifestEnvelopeSchema = z.object({
  zerops: z.array(mutableRecordSchema).min(1).max(30),
});

const portEntrySchema = z.looseObject({
  port: z.number().int().min(10).max(65_435),
  protocol: z.enum(["TCP", "UDP"]).optional(),
  httpSupport: z.boolean().optional(),
});

const selectedSetupSchema = z.object({
  setup: z.string().min(1).max(64),
  build: z
    .object({
      buildCommands: z.array(z.string().min(1).max(2_000)).max(40).optional(),
    })
    .optional(),
  run: z.object({
    start: z.string().min(1).max(2_000),
    envVariables: z.record(z.string(), z.string()).optional(),
  }),
});

const zeropsManifestSchema = z.object({
  zerops: z.array(selectedSetupSchema).min(1).max(30),
});

export interface LocalSetupCommands {
  readonly buildCommands: readonly string[];
  readonly startCommand: string;
  readonly environment: Readonly<Record<string, string>>;
}

export interface PreparedZeropsManifest {
  readonly path: string;
  readonly yaml: string;
  readonly sha256: string;
  readonly bindingDiff: readonly {
    readonly environmentName: string;
    readonly value: string | null;
  }[];
  cleanup(): Promise<void>;
}

export interface LoadedZeropsManifest {
  readonly path: string;
  readonly yaml: string;
}

export async function loadZeropsManifest(workspaceDirectory: string): Promise<LoadedZeropsManifest> {
  for (const basename of ["zerops.yaml", "zerops.yml"] as const) {
    const path = join(workspaceDirectory, basename);
    let handle;
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile()) throw new Error(`${basename} must be a regular file.`);
      if (metadata.size === 0) throw new Error(`${basename} is empty.`);
      if (metadata.size > MAX_MANIFEST_BYTES) {
        throw new Error(`${basename} exceeds the ${MAX_MANIFEST_BYTES}-byte parser limit.`);
      }
      return { path, yaml: await handle.readFile({ encoding: "utf8" }) };
    } finally {
      await handle.close();
    }
  }
  throw new Error("The repository must contain zerops.yaml or zerops.yml at its root.");
}

function selectedSetup(manifest: z.infer<typeof manifestEnvelopeSchema>, setupName: string): Record<string, unknown> {
  const matches = manifest.zerops.filter((candidate) => candidate.setup === setupName);
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `The Zerops manifest does not contain setup ${setupName}.`
        : `The Zerops manifest contains duplicate setup ${setupName}.`,
    );
  }
  return matches[0] ?? {};
}

function mutableChild(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const current = parent[key];
  if (current === undefined) {
    const created: Record<string, unknown> = {};
    parent[key] = created;
    return created;
  }
  // Zod intentionally returns a cloned object. Put the validated clone back
  // into the manifest tree so later mutations are serialized.
  const validated = mutableRecordSchema.parse(current);
  parent[key] = validated;
  return validated;
}

export function assertZeropsDeploymentContract(
  yaml: string,
  deployment: CompiledDeploymentTarget,
): void {
  const parsedYaml: unknown = parseYaml(yaml);
  const parsed = manifestEnvelopeSchema.parse(parsedYaml);
  const setup = selectedSetup(parsed, deployment.setup);
  const run = mutableRecordSchema.parse(setup.run);
  const ports = z.array(portEntrySchema).max(40).parse(run.ports ?? []);
  const port = ports.find((candidate) => candidate.port === deployment.port);
  if (!port || port.protocol === "UDP" || port.httpSupport !== true) {
    throw new Error(
      `Setup ${deployment.setup} must expose TCP port ${deployment.port} with httpSupport enabled.`,
    );
  }
  const deploy = mutableRecordSchema.parse(setup.deploy);
  const readiness = z
    .object({
      httpGet: z.object({
        port: z.literal(deployment.port),
        path: z.literal(deployment.healthPath),
      }),
    })
    .parse(deploy.readinessCheck);
  if (!readiness.httpGet) throw new Error(`Setup ${deployment.setup} lacks its HTTP readiness gate.`);
}

/**
 * Creates a private, disposable manifest for one base/head service. The source
 * checkout is never modified. Only the selected setup's dependency bindings,
 * secret collisions, HTTP port, and readiness gate are changed.
 */
export async function prepareZeropsManifest(
  workspaceDirectory: string,
  deployment: CompiledDeploymentTarget,
): Promise<PreparedZeropsManifest> {
  if (deployment.side === "executor") {
    throw new Error("Repository manifest patching is only valid for base/head deployments.");
  }
  const { yaml: sourceYaml } = await loadZeropsManifest(workspaceDirectory);
  const parsedYaml: unknown = parseYaml(sourceYaml);
  const parsed = manifestEnvelopeSchema.parse(parsedYaml);
  const setup = selectedSetup(parsed, deployment.setup);
  const run = mutableChild(setup, "run");
  const envVariables = mutableChild(run, "envVariables");
  const bindingDiff: Array<{ environmentName: string; value: string | null }> = [];

  for (const binding of deployment.environmentBindings) {
    const value = `\${${binding.sourceHostname}_${binding.sourceProperty}}`;
    envVariables[binding.environmentName] = value;
    bindingDiff.push({ environmentName: binding.environmentName, value });
  }
  for (const binding of deployment.secretBindings) {
    if (Object.hasOwn(envVariables, binding.environmentName)) {
      delete envVariables[binding.environmentName];
    }
    bindingDiff.push({ environmentName: binding.environmentName, value: null });
  }

  const ports = z.array(portEntrySchema).max(40).parse(run.ports ?? []);
  const matchingPort = ports.find((entry) => entry.port === deployment.port);
  if (matchingPort?.protocol === "UDP") {
    throw new Error(`Setup ${deployment.setup} declares HTTP port ${deployment.port} as UDP.`);
  }
  if (matchingPort) {
    matchingPort.protocol = "TCP";
    matchingPort.httpSupport = true;
  } else {
    ports.push({ port: deployment.port, protocol: "TCP", httpSupport: true });
  }
  run.ports = ports;

  const deploy = mutableChild(setup, "deploy");
  deploy.readinessCheck = {
    httpGet: { port: deployment.port, path: deployment.healthPath },
    failureTimeout: 120,
    retryPeriod: 5,
  };

  const yaml = stringifyYaml(parsed, { lineWidth: 0 });
  if (Buffer.byteLength(yaml, "utf8") > MAX_MANIFEST_BYTES) {
    throw new Error(`Patched zerops.yaml exceeds the ${MAX_MANIFEST_BYTES}-byte parser limit.`);
  }
  assertZeropsDeploymentContract(yaml, deployment);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "trialrun-zerops-manifest-"));
  const path = join(temporaryDirectory, "zerops.yaml");
  try {
    await writeFile(path, yaml, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
  let cleaned = false;
  return {
    path,
    yaml,
    sha256: createHash("sha256").update(yaml).digest("hex"),
    bindingDiff,
    cleanup: async () => {
      if (cleaned) return;
      cleaned = true;
      await rm(temporaryDirectory, { recursive: true, force: true });
    },
  };
}

export async function loadLocalSetup(
  workspaceDirectory: string,
  sourceRoot: string,
  setupName: string,
): Promise<LocalSetupCommands> {
  safeRelativePathSchema.parse(sourceRoot);
  const { yaml } = await loadZeropsManifest(workspaceDirectory);
  const parsedYaml: unknown = parseYaml(yaml);
  const manifest = zeropsManifestSchema.parse(parsedYaml);
  const setup = manifest.zerops.find((candidate) => candidate.setup === setupName);
  if (!setup) throw new Error(`zerops.yaml does not contain setup ${setupName}.`);
  return {
    buildCommands: setup.build?.buildCommands ?? [],
    startCommand: setup.run.start,
    environment: setup.run.envVariables ?? {},
  };
}
