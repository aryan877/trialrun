import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  safeRelativePathSchema,
  zeropsApplicationTypeSchema,
  zeropsBuildTypeSchema,
  type CompiledDeploymentTarget,
} from "@trialrun/domain";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

const MAX_MANIFEST_BYTES = 256_000;
const setupNameSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const environmentNameSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/);

const portEntrySchema = z.looseObject({
  port: z.number().int().min(10).max(65_435),
  protocol: z.enum(["TCP", "UDP", "tcp", "udp"]).optional(),
  httpSupport: z.boolean().optional(),
});

const readinessSchema = z.strictObject({
  httpGet: z.strictObject({
    port: z.number().int().min(10).max(65_435),
    path: z.string().regex(/^\/(?!\/)[^\s?#]*$/).max(300),
  }),
});

const deploymentContractSetupSchema = z.looseObject({
  setup: setupNameSchema,
  deploy: z.looseObject({ readinessCheck: readinessSchema }),
  run: z.looseObject({ ports: z.array(portEntrySchema).max(40) }),
});

const manifestEnvelopeSchema = z.looseObject({
  zerops: z.array(deploymentContractSetupSchema).min(1).max(30),
});

const generatedSetupSchema = z.strictObject({
  setup: setupNameSchema,
  build: z.strictObject({
    base: zeropsBuildTypeSchema,
    buildCommands: z.array(z.string().min(1).max(6_000)).max(40).optional(),
    deployFiles: z.array(safeRelativePathSchema).min(1).max(40),
  }),
  deploy: z.strictObject({ readinessCheck: readinessSchema }),
  run: z.strictObject({
    base: zeropsApplicationTypeSchema,
    ports: z.tuple([
      z.strictObject({
        port: z.number().int().min(10).max(65_435),
        httpSupport: z.literal(true),
      }),
    ]),
    envVariables: z.record(environmentNameSchema, z.string().min(1).max(500)).optional(),
    start: z.string().min(1).max(6_000),
  }),
});

const generatedManifestSchema = z.strictObject({
  zerops: z.tuple([generatedSetupSchema]),
});

const executorPrepareCommand =
  "PLAYWRIGHT_BROWSERS_PATH=/home/zerops/.cache/ms-playwright PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=120000 npx --yes playwright@1.62.1 install --with-deps --only-shell chromium";

const executorManifestSchema = z.strictObject({
  zerops: z.tuple([
    z.strictObject({
      setup: z.literal("executor"),
      build: z.strictObject({
        base: z.literal("ubuntu/nodejs@24"),
        deployFiles: z.literal("."),
      }),
      deploy: z.strictObject({
        readinessCheck: z.strictObject({
          httpGet: z.strictObject({ port: z.literal(3_000), path: z.literal("/health") }),
        }),
      }),
      run: z.strictObject({
        base: z.literal("ubuntu/nodejs@24"),
        prepareCommands: z.tuple([z.literal(executorPrepareCommand)]),
        envVariables: z.strictObject({
          PLAYWRIGHT_BROWSERS_PATH: z.literal("/home/zerops/.cache/ms-playwright"),
        }),
        ports: z.tuple([
          z.strictObject({ port: z.literal(3_000), httpSupport: z.literal(true) }),
        ]),
        start: z.literal("./node_modules/.bin/tsx src/index.ts"),
      }),
    }),
  ]),
});

type ApplicationDeployment = Extract<
  CompiledDeploymentTarget,
  { readonly side: "base" | "head" }
>;

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

function errorCode(error: unknown): string | undefined {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    typeof error.code !== "string"
  ) {
    return undefined;
  }
  return error.code;
}

export async function loadZeropsManifest(workspaceDirectory: string): Promise<LoadedZeropsManifest> {
  for (const basename of ["zerops.yaml", "zerops.yml"] as const) {
    const path = join(workspaceDirectory, basename);
    let handle;
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if (errorCode(error) === "ENOENT") continue;
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
  throw new Error("The TrialRun executor bundle must contain zerops.yaml or zerops.yml.");
}

function selectedSetup(
  manifest: z.infer<typeof manifestEnvelopeSchema>,
  setupName: string,
): z.infer<typeof deploymentContractSetupSchema> {
  const matches = manifest.zerops.filter((candidate) => candidate.setup === setupName);
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `The Zerops manifest does not contain setup ${setupName}.`
        : `The Zerops manifest contains duplicate setup ${setupName}.`,
    );
  }
  const setup = matches[0];
  if (!setup) throw new Error(`The Zerops manifest does not contain setup ${setupName}.`);
  return setup;
}

function shellArgument(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function commandInSourceRoot(sourceRoot: string, command: string, replaceProcess: boolean): string {
  if (sourceRoot === ".") return command;
  const script = `cd -- ${shellArgument(sourceRoot)} && ${replaceProcess ? "exec " : ""}${command}`;
  return `sh -lc ${shellArgument(script)}`;
}

function deployFileFromWorkspace(sourceRoot: string, path: string): string {
  if (sourceRoot === ".") return path;
  return path === "." ? sourceRoot : `${sourceRoot}/${path}`;
}

function environmentVariablesFor(
  deployment: ApplicationDeployment,
): Readonly<Record<string, string>> {
  const environment: Record<string, string> = {};
  for (const binding of deployment.environmentBindings) {
    if (Object.hasOwn(environment, binding.environmentName)) {
      throw new Error(`Deployment contains duplicate binding ${binding.environmentName}.`);
    }
    environment[binding.environmentName] =
      `\${${binding.sourceHostname}_${binding.sourceProperty}}`;
  }
  return environment;
}

function generatedSetupFor(
  deployment: ApplicationDeployment,
): z.infer<typeof generatedSetupSchema> {
  const environment = environmentVariablesFor(deployment);
  const buildCommands = deployment.build.buildCommands.map((command) =>
    commandInSourceRoot(deployment.sourceRoot, command, false),
  );
  return generatedSetupSchema.parse({
    setup: deployment.setup,
    build: {
      base: deployment.build.base,
      ...(buildCommands.length > 0 ? { buildCommands } : {}),
      deployFiles: deployment.build.deployFiles.map((path) =>
        deployFileFromWorkspace(deployment.sourceRoot, path),
      ),
    },
    deploy: {
      readinessCheck: {
        httpGet: { port: deployment.port, path: deployment.healthPath },
      },
    },
    run: {
      base: deployment.run.base,
      ports: [{ port: deployment.port, httpSupport: true }],
      ...(Object.keys(environment).length > 0 ? { envVariables: environment } : {}),
      start: commandInSourceRoot(deployment.sourceRoot, deployment.run.start, true),
    },
  });
}

function equalStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function equalEnvironment(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftEntries = Object.entries(left).sort(([leftName], [rightName]) =>
    leftName.localeCompare(rightName),
  );
  const rightEntries = Object.entries(right).sort(([leftName], [rightName]) =>
    leftName.localeCompare(rightName),
  );
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(
      ([name, value], index) =>
        name === rightEntries[index]?.[0] && value === rightEntries[index]?.[1],
    )
  );
}

export function assertZeropsDeploymentContract(
  yaml: string,
  deployment: CompiledDeploymentTarget,
): void {
  const parsedYaml: unknown = parseYaml(yaml);
  if (deployment.side === "executor") {
    if (
      deployment.setup !== "executor" ||
      deployment.port !== 3_000 ||
      deployment.healthPath !== "/health"
    ) {
      throw new Error("The compiled executor target does not match TrialRun's pinned contract.");
    }
    executorManifestSchema.parse(parsedYaml);
    return;
  }
  const parsed = manifestEnvelopeSchema.parse(parsedYaml);
  const setup = selectedSetup(parsed, deployment.setup);
  const port = setup.run.ports.find((candidate) => candidate.port === deployment.port);
  if (!port || port.protocol?.toLowerCase() === "udp" || port.httpSupport !== true) {
    throw new Error(
      `Setup ${deployment.setup} must expose TCP port ${deployment.port} with httpSupport enabled.`,
    );
  }
  const readiness = setup.deploy.readinessCheck;
  if (
    readiness.httpGet.port !== deployment.port ||
    readiness.httpGet.path !== deployment.healthPath
  ) {
    throw new Error(`Setup ${deployment.setup} lacks its exact HTTP readiness gate.`);
  }
  const generated = generatedManifestSchema.parse(parsedYaml).zerops[0];
  const expected = generatedSetupFor(deployment);
  if (
    generated.setup !== expected.setup ||
    generated.build.base !== expected.build.base ||
    !equalStrings(generated.build.buildCommands ?? [], expected.build.buildCommands ?? []) ||
    !equalStrings(generated.build.deployFiles, expected.build.deployFiles) ||
    generated.run.base !== expected.run.base ||
    generated.run.start !== expected.run.start ||
    !equalEnvironment(generated.run.envVariables ?? {}, expected.run.envVariables ?? {})
  ) {
    throw new Error(`Setup ${deployment.setup} does not match the approved deployment plan.`);
  }
}

/**
 * Creates a complete private manifest for one base/head service. Customer
 * manifests are intentionally neither required nor read: the confirmed recipe
 * is the only deployment-plan input.
 */
export async function prepareZeropsManifest(
  _workspaceDirectory: string,
  deployment: CompiledDeploymentTarget,
): Promise<PreparedZeropsManifest> {
  if (deployment.side === "executor") {
    throw new Error("Generated repository manifests are only valid for base/head deployments.");
  }
  const manifest = generatedManifestSchema.parse({ zerops: [generatedSetupFor(deployment)] });
  const yaml = stringifyYaml(manifest, { lineWidth: 0 });
  if (Buffer.byteLength(yaml, "utf8") > MAX_MANIFEST_BYTES) {
    throw new Error(`Generated zerops.yaml exceeds the ${MAX_MANIFEST_BYTES}-byte parser limit.`);
  }
  assertZeropsDeploymentContract(yaml, deployment);

  const bindingDiff: Array<{ environmentName: string; value: string | null }> = [
    ...deployment.environmentBindings.map(({ environmentName, sourceHostname, sourceProperty }) => ({
      environmentName,
      value: `\${${sourceHostname}_${sourceProperty}}`,
    })),
    ...deployment.secretBindings.map(({ environmentName }) => ({ environmentName, value: null })),
  ];
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
