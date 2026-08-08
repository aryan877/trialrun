import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  compileZeropsReviewTopology,
  randomToken,
  redactText,
  zeropsManagedTypeSchema,
  zeropsRuntimeTypeSchema,
  type CompiledDeploymentTarget,
} from "@trialrun/domain";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import type { ValidateFunction } from "ajv";

import {
  assertZeropsDeploymentContract,
  loadZeropsManifest,
  prepareZeropsManifest,
} from "./zerops-manifest";
import { assertMatchesZeropsSchema, compileZeropsSchema } from "./zerops-schema";
import { liveBrowserEvidenceEnvelopeSchema } from "./live-protocol";
import type {
  ExecutionEnvironment,
  ExecutionProvider,
  ProvisionInput,
  ReviewSide,
  TeardownProof,
} from "./types";

const processSchema = z
  .object({
    id: z.string().min(1),
    status: z.enum(["PENDING", "RUNNING", "ROLLBACKING", "CANCELING", "FINISHED", "FAILED", "CANCELED"]),
    actionName: z.string().optional(),
  })
  .passthrough();

const importResponseSchema = z.object({
  projectId: z.string().min(1),
  projectName: z.string().min(1),
  serviceStacks: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      processes: z.array(processSchema),
    }),
  ),
});

const serviceStackSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    status: z.string(),
    subdomainAccess: z.boolean(),
    userData: z.array(z.object({ key: z.string(), content: z.string() })),
  })
  .passthrough();

const projectSchema = z
  .object({
    id: z.string().min(1),
    clientId: z.string().min(1),
    description: z.string().nullable(),
    tagList: z.array(z.string()),
    status: z.string(),
    zeropsSubdomainHost: z.string().min(1).nullable(),
  })
  .passthrough();

const deleteResponseSchema = processSchema;

const environmentNameSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/);
const verticalAutoscalingSchema = z.union([
  z.strictObject({
    cpuMode: z.literal("SHARED"),
    minCpu: z.number().int().min(1).max(8),
    maxCpu: z.number().int().min(1).max(8),
    minRam: z.number().min(0.25).max(32),
    maxRam: z.number().min(0.25).max(32),
    minDisk: z.number().int().min(1).max(100),
    maxDisk: z.number().int().min(1).max(100),
  }),
  z.strictObject({
    cpuMode: z.literal("SHARED"),
    cpu: z.number().int().min(1).max(8),
    ram: z.number().min(1).max(32),
    disk: z.number().int().min(5).max(100),
  }),
]);
const generatedImportSchema = z.strictObject({
  project: z.strictObject({
    name: z.string().min(1).max(50),
    description: z.string().min(1).max(1_000),
    corePackage: z.literal("LIGHT"),
    tags: z.tuple([z.literal("trialrun"), z.literal("ephemeral-review")]),
  }),
  services: z
    .array(
      z.strictObject({
        hostname: z.string().regex(/^[a-z][a-z0-9]{0,24}$/),
        type: z.union([zeropsRuntimeTypeSchema, zeropsManagedTypeSchema]),
        enableSubdomainAccess: z.boolean().optional(),
        objectStorageSize: z.number().int().min(1).max(5).optional(),
        objectStoragePolicy: z.literal("private").optional(),
        verticalAutoscaling: verticalAutoscalingSchema.optional(),
        envSecrets: z.record(environmentNameSchema, z.string().max(8_000)).optional(),
      }),
    )
    .min(3)
    .max(15),
});

const ownershipTokenHashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const liveArtifactIdSchema = z.string().regex(/^artifact:[0-9a-f]{64}$/);
const maximumExecutorJsonBytes = 4 * 1_024 * 1_024;
const reviewProjectTags = ["trialrun", "ephemeral-review"] as const;

function assertOwnedReviewProject(
  project: z.infer<typeof projectSchema>,
  expected: {
    readonly projectId: string;
    readonly clientId: string;
    readonly description: string;
  },
): void {
  if (
    project.id !== expected.projectId ||
    project.clientId !== expected.clientId ||
    project.description !== expected.description ||
    !reviewProjectTags.every((tag) => project.tagList.includes(tag))
  ) {
    throw new Error("Zerops project ownership marker does not match this TrialRun review.");
  }
}

interface PreparedDeployment {
  readonly deployment: CompiledDeploymentTarget;
  readonly workingDirectory: string;
  readonly manifestPath: string;
  readonly manifestYaml: string;
  readonly manifestSha256: string;
  cleanup(): Promise<void>;
}

export interface ZeropsExecutionProviderOptions {
  readonly apiUrl: string;
  readonly accessToken: string;
  readonly clientId: string;
  readonly executorSourceDirectory: string;
  readonly zcliBinary?: string;
  readonly timeoutMs?: number;
}

function publicUrlFromProject(
  project: z.infer<typeof projectSchema>,
  hostname: string,
  port: number,
): string {
  const subdomainHost = project.zeropsSubdomainHost;
  if (!subdomainHost) throw new Error("Zerops project did not expose its generated subdomain host.");
  const candidate = new URL(`https://${subdomainHost}`);
  if (
    candidate.hostname !== subdomainHost ||
    !candidate.hostname.endsWith(".zerops.app") ||
    candidate.hostname.split(".").length < 4
  ) {
    throw new Error("Zerops project returned an invalid generated subdomain host.");
  }
  const [prefix, ...zone] = candidate.hostname.split(".");
  if (!prefix || zone.length < 3) {
    throw new Error("Zerops project returned an incomplete generated subdomain host.");
  }
  const portSuffix = port === 80 ? "" : `-${port}`;
  return `https://${hostname}-${prefix}${portSuffix}.${zone.join(".")}`;
}

function encodeTestSecrets(secrets: Readonly<Record<string, string>>): string {
  return Buffer.from(JSON.stringify(secrets), "utf8").toString("base64");
}

async function readExecutorJson(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const bytes = Number(declaredLength);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maximumExecutorJsonBytes) {
      throw new Error("TrialRun executor returned an invalid or oversized JSON response.");
    }
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximumExecutorJsonBytes) {
    throw new Error("TrialRun executor returned an oversized JSON response.");
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
    return parsed;
  } catch {
    throw new Error("TrialRun executor returned invalid JSON.");
  }
}

export class ZeropsExecutionProvider implements ExecutionProvider {
  readonly #options: Required<Omit<ZeropsExecutionProviderOptions, "timeoutMs" | "zcliBinary">> & {
    timeoutMs: number;
    zcliBinary: string;
  };
  #liveImportValidator: ValidateFunction<unknown> | null = null;
  #liveManifestValidator: ValidateFunction<unknown> | null = null;

  constructor(options: ZeropsExecutionProviderOptions) {
    const apiUrl = new URL(options.apiUrl);
    if (
      apiUrl.protocol !== "https:" ||
      apiUrl.hostname !== "api.app-prg1.zerops.io" ||
      apiUrl.pathname.replace(/\/$/, "") !== "/api/rest/public"
    ) {
      throw new Error(
        "This pinned zCLI integration currently supports only the official Prague API at https://api.app-prg1.zerops.io/api/rest/public.",
      );
    }
    this.#options = {
      ...options,
      executorSourceDirectory: resolve(options.executorSourceDirectory),
      timeoutMs: options.timeoutMs ?? 15 * 60_000,
      zcliBinary: options.zcliBinary ?? "zcli",
    };
  }

  async #request(path: string, init: RequestInit = {}): Promise<unknown> {
    const requestTimeout = AbortSignal.timeout(30_000);
    const response = await fetch(`${this.#options.apiUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.#options.accessToken}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      signal: init.signal ? AbortSignal.any([init.signal, requestTimeout]) : requestTimeout,
    });
    const body = await response.text();
    if (!response.ok) {
      const requestId = response.headers.get("x-request-id");
      throw new Error(
        `Zerops API ${init.method ?? "GET"} ${path} returned HTTP ${response.status}${requestId ? ` (request ${requestId})` : ""}.`,
      );
    }
    if (!body) return {};
    const parsedBody: unknown = JSON.parse(body);
    return parsedBody;
  }

  async #schemaValidator(
    kind: "import" | "manifest",
    signal?: AbortSignal,
  ): Promise<ValidateFunction<unknown>> {
    const cached = kind === "import" ? this.#liveImportValidator : this.#liveManifestValidator;
    if (cached) return cached;
    const filename =
      kind === "import" ? "import-project-yml-json-schema.json" : "zerops-yml-json-schema.json";
    const validator = compileZeropsSchema(
      await this.#request(`/settings/${filename}`, { ...(signal ? { signal } : {}) }),
    );
    if (kind === "import") this.#liveImportValidator = validator;
    else this.#liveManifestValidator = validator;
    return validator;
  }

  async #validateImportContract(
    value: unknown,
    signal?: AbortSignal,
  ): Promise<z.infer<typeof generatedImportSchema>> {
    const generated = generatedImportSchema.parse(value);
    assertMatchesZeropsSchema(
      await this.#schemaValidator("import", signal),
      generated,
      "Generated project import",
    );
    return generated;
  }

  async #validateManifest(yaml: string, signal?: AbortSignal): Promise<void> {
    const parsed: unknown = parseYaml(yaml);
    assertMatchesZeropsSchema(
      await this.#schemaValidator("manifest", signal),
      parsed,
      "Deployment zerops.yaml",
    );
  }

  async #projectIsAbsent(projectId: string): Promise<boolean> {
    const response = await fetch(
      `${this.#options.apiUrl.replace(/\/$/, "")}/project/${encodeURIComponent(projectId)}`,
      {
        headers: { Accept: "application/json", Authorization: `Bearer ${this.#options.accessToken}` },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (response.status === 404) return true;
    if (!response.ok) throw new Error(`Zerops project absence check returned HTTP ${response.status}.`);
    return false;
  }

  async #waitForProcess(processId: string, signal?: AbortSignal): Promise<void> {
    const deadline = Date.now() + this.#options.timeoutMs;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      const process = processSchema.parse(
        await this.#request(`/process/${encodeURIComponent(processId)}`, {
          ...(signal ? { signal } : {}),
        }),
      );
      if (process.status === "FINISHED") return;
      if (["FAILED", "CANCELED"].includes(process.status)) {
        throw new Error(`Zerops process ${processId} ended as ${process.status}.`);
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
    }
    throw new Error(`Timed out waiting for Zerops process ${processId}.`);
  }

  async #waitForPublicExecutor(executorUrl: string, signal?: AbortSignal): Promise<void> {
    const deadline = Date.now() + this.#options.timeoutMs;
    const healthUrl = new URL("/health", executorUrl);
    let lastStatus = "not reachable";
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      try {
        const requestSignal = signal
          ? AbortSignal.any([signal, AbortSignal.timeout(5_000)])
          : AbortSignal.timeout(5_000);
        const response = await fetch(healthUrl, { signal: requestSignal, redirect: "error" });
        if (response.ok) return;
        lastStatus = `HTTP ${response.status}`;
      } catch (error) {
        lastStatus = error instanceof Error ? error.message : String(error);
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
    }
    throw new Error(`Timed out waiting for the public TrialRun executor health gate: ${lastStatus}.`);
  }

  async #runZcli(
    args: readonly string[],
    secretValues: readonly string[],
    signal?: AbortSignal,
  ): Promise<string> {
    const isolatedDirectory = await mkdtemp(join(tmpdir(), "trialrun-zcli-"));
    try {
      return await new Promise((resolveOutput, rejectOutput) => {
        const child = spawn(this.#options.zcliBinary, [...args], {
          env: {
            PATH: process.env.PATH,
            LANG: process.env.LANG ?? "C.UTF-8",
            ZEROPS_TOKEN: this.#options.accessToken,
            ZEROPS_CLI_TERMINAL_MODE: "disabled",
            ZEROPS_CLI_DATA_FILE_PATH: join(isolatedDirectory, "cli.data"),
            ZEROPS_CLI_LOG_FILE_PATH: join(isolatedDirectory, "zcli.log"),
            ZEROPS_CLI_YAML_FILE_PATH: join(isolatedDirectory, "zcli.yml"),
          },
          stdio: ["ignore", "pipe", "pipe"],
          timeout: this.#options.timeoutMs,
          killSignal: "SIGTERM",
          ...(signal ? { signal } : {}),
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => {
          stdout = `${stdout}${chunk.toString("utf8")}`.slice(-200_000);
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderr = `${stderr}${chunk.toString("utf8")}`.slice(-200_000);
        });
        child.once("error", rejectOutput);
        child.once("exit", (code, exitSignal) => {
          const output = redactText(`${stdout}${stderr}`, secretValues);
          if (code === 0) resolveOutput(output);
          else {
            rejectOutput(
              new Error(`zCLI ${args[0] ?? "command"} exited with ${code ?? exitSignal}: ${output}`),
            );
          }
        });
      });
    } finally {
      await rm(isolatedDirectory, { recursive: true, force: true });
    }
  }

  async #pushDeployment(
    projectId: string,
    serviceId: string,
    prepared: PreparedDeployment,
    input: ProvisionInput,
    executorToken: string,
  ): Promise<void> {
    await this.#runZcli(
      [
        "service",
        "push",
        "--project-id",
        projectId,
        "--service-id",
        serviceId,
        "--setup",
        prepared.deployment.setup,
        "--working-dir",
        prepared.workingDirectory,
        "--zerops-yaml-path",
        prepared.manifestPath,
        "--no-git",
        "--disable-logs",
      ],
      [
        this.#options.accessToken,
        executorToken,
        encodeTestSecrets(input.secrets),
        ...Object.values(input.secrets),
      ],
      input.signal,
    );
  }

  async #prepareDeployment(
    deployment: CompiledDeploymentTarget,
    input: ProvisionInput,
  ): Promise<PreparedDeployment> {
    const workingDirectory =
      deployment.side === "executor"
        ? this.#options.executorSourceDirectory
        : input.sourceWorkspaces[deployment.side].directory;
    if (deployment.side === "executor") {
      const loaded = await loadZeropsManifest(workingDirectory);
      assertZeropsDeploymentContract(loaded.yaml, deployment);
      await this.#validateManifest(loaded.yaml, input.signal);
      return {
        deployment,
        workingDirectory,
        manifestPath: loaded.path,
        manifestYaml: loaded.yaml,
        manifestSha256: createHash("sha256").update(loaded.yaml).digest("hex"),
        cleanup: () => Promise.resolve(),
      };
    }
    const prepared = await prepareZeropsManifest(workingDirectory, deployment);
    try {
      await this.#validateManifest(prepared.yaml, input.signal);
    } catch (error) {
      await prepared.cleanup();
      throw error;
    }
    return {
      deployment,
      workingDirectory,
      manifestPath: prepared.path,
      manifestYaml: prepared.yaml,
      manifestSha256: prepared.sha256,
      cleanup: () => prepared.cleanup(),
    };
  }

  async provision(input: ProvisionInput): Promise<ExecutionEnvironment> {
    const ownershipTokenHash = ownershipTokenHashSchema.parse(input.ownershipTokenHash);
    const ownershipDescription = `TrialRun review ${input.reviewId}; ownership-sha256=${ownershipTokenHash}`;
    const baseSha = input.sourceWorkspaces.base.sha;
    const headSha = input.sourceWorkspaces.head.sha;
    const topology = compileZeropsReviewTopology(input.recipe, {
      reviewId: input.reviewId,
      baseSha,
      headSha,
    });
    const executorToken = randomToken();
    const primaryDeployment = topology.deployments.find(
      (deployment) => deployment.side === "base" && deployment.logicalService === input.recipe.primaryService,
    );
    if (!primaryDeployment) throw new Error("Compiled topology is missing its primary application deployment.");
    const baseUrl = `http://base${input.recipe.primaryService}:${primaryDeployment.port}`;
    const headUrl = `http://head${input.recipe.primaryService}:${primaryDeployment.port}`;
    const services = topology.services.map((service) => {
      const deployment = topology.deployments.find(({ hostname }) => hostname === service.hostname);
      const deploymentSecrets =
        deployment?.side === "base" || deployment?.side === "head"
          ? Object.fromEntries(
              deployment.secretBindings.map(({ environmentName, secretName }) => {
                const value = input.secrets[secretName];
                if (!value) throw new Error(`Required repository secret ${secretName} is missing.`);
                return [environmentName, value];
              }),
            )
          : deployment?.side === "executor"
            ? {
                TRIALRUN_EXECUTION_TOKEN: executorToken,
                TRIALRUN_REVIEW_ID: input.reviewId,
                TRIALRUN_BASE_URL: baseUrl,
                TRIALRUN_HEAD_URL: headUrl,
                TRIALRUN_BASE_HEALTH_PATH: primaryDeployment.healthPath,
                TRIALRUN_HEAD_HEALTH_PATH: primaryDeployment.healthPath,
                TRIALRUN_TEST_SECRETS_BASE64: encodeTestSecrets(input.secrets),
              }
            : {};
      const envSecrets = { ...service.envSecrets, ...deploymentSecrets };
      return { ...service, ...(Object.keys(envSecrets).length > 0 ? { envSecrets } : {}) };
    });
    const importDefinition = await this.#validateImportContract(
      {
        project: {
          ...topology.project,
          description: ownershipDescription,
        },
        services,
      },
      input.signal,
    );
    const yaml = stringifyYaml(importDefinition);
    if (Buffer.byteLength(yaml, "utf8") > 100_000) {
      throw new Error("Generated Zerops import YAML exceeds the documented 100 kB limit.");
    }
    const preparedDeployments: PreparedDeployment[] = [];
    try {
      for (const deployment of topology.deployments) {
        preparedDeployments.push(await this.#prepareDeployment(deployment, input));
      }
      const imported = importResponseSchema.parse(
        await this.#request(`/client/${encodeURIComponent(this.#options.clientId)}/project/import`, {
          method: "POST",
          body: JSON.stringify({ yaml }),
          ...(input.signal ? { signal: input.signal } : {}),
        }),
      );
      const serviceByHostname = (hostname: string) => {
        const service = imported.serviceStacks.find((candidate) => candidate.name === hostname);
        if (!service) throw new Error(`Zerops import did not return service ${hostname}.`);
        return service;
      };

      try {
        await input.onProjectCreated?.(imported.projectId);
        await Promise.all(
          imported.serviceStacks.flatMap((service) =>
            service.processes.map((process) => this.#waitForProcess(process.id, input.signal)),
          ),
        );
        for (const prepared of preparedDeployments) {
          await this.#pushDeployment(
            imported.projectId,
            serviceByHostname(prepared.deployment.hostname).id,
            prepared,
            input,
            executorToken,
          );
        }
        const executorService = serviceStackSchema.parse(
          await this.#request(`/service-stack/${encodeURIComponent(serviceByHostname("executor").id)}`, {
            ...(input.signal ? { signal: input.signal } : {}),
          }),
        );
        if (!executorService.subdomainAccess) {
          throw new Error("Zerops did not enable public subdomain access for the live executor.");
        }
        const project = projectSchema.parse(
          await this.#request(`/project/${encodeURIComponent(imported.projectId)}`, {
            ...(input.signal ? { signal: input.signal } : {}),
          }),
        );
        assertOwnedReviewProject(project, {
          projectId: imported.projectId,
          clientId: this.#options.clientId,
          description: ownershipDescription,
        });
        const executorDeployment = preparedDeployments.find(
          ({ deployment }) => deployment.side === "executor",
        )?.deployment;
        if (!executorDeployment) throw new Error("Compiled topology is missing the executor deployment.");
        const executorUrl = publicUrlFromProject(
          project,
          executorDeployment.hostname,
          executorDeployment.port,
        );
        await this.#waitForPublicExecutor(executorUrl, input.signal);
        const executorRequest = async (path: string, init: RequestInit = {}): Promise<Response> => {
          const response = await fetch(new URL(path, executorUrl), {
            ...init,
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${executorToken}`,
              ...init.headers,
            },
            redirect: "error",
            signal: init.signal ?? AbortSignal.timeout(30_000),
          });
          if (!response.ok) {
            throw new Error(
              `TrialRun executor ${init.method ?? "GET"} ${path} returned HTTP ${response.status}.`,
            );
          }
          return response;
        };
        const readLiveEvidence = async () => {
          const payload = await readExecutorJson(await executorRequest("/evidence"));
          return liveBrowserEvidenceEnvelopeSchema.parse(payload).evidence;
        };
        const primary = input.recipe.primaryService;
        let deletionProcessId: string | null = null;
        return {
        provider: "zerops",
        providerProjectId: imported.projectId,
        baseUrl,
        headUrl,
        liveReview: {
          mcpUrl: new URL("/mcp", executorUrl).href,
          bearerToken: executorToken,
        },
        readLiveEvidence,
        readLiveArtifact: async (artifactId: string) => {
          const validatedArtifactId = liveArtifactIdSchema.parse(artifactId);
          const evidence = await readLiveEvidence();
          const checkpoint = evidence.checkpoints.find(
            (candidate) => candidate.artifactId === validatedArtifactId,
          );
          if (!checkpoint?.captured || !checkpoint.digest || !checkpoint.byteSize) {
            throw new Error("Live artifact is not present in the sealed evidence manifest.");
          }
          const response = await executorRequest(
            `/artifacts/${encodeURIComponent(validatedArtifactId)}`,
          );
          const declaredLength = Number(response.headers.get("content-length"));
          if (declaredLength !== checkpoint.byteSize) {
            throw new Error("Live artifact response length does not match its evidence manifest.");
          }
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.byteLength !== checkpoint.byteSize) {
            throw new Error("Live artifact byte length does not match its evidence manifest.");
          }
          const digest = createHash("sha256").update(bytes).digest("hex");
          if (digest !== checkpoint.digest) {
            throw new Error("Live artifact digest does not match its evidence manifest.");
          }
          return bytes;
        },
        cancelLiveReview: async () => {
          const payload = await readExecutorJson(
            await executorRequest("/cancel", { method: "POST" }),
          );
          return liveBrowserEvidenceEnvelopeSchema.parse(payload).evidence;
        },
        sealLiveReview: async () => {
          const payload = await readExecutorJson(
            await executorRequest("/finish", { method: "POST" }),
          );
          return liveBrowserEvidenceEnvelopeSchema.parse(payload).evidence;
        },
        readLogs: async (side: ReviewSide) =>
          this.#runZcli(
            [
              "service",
              "log",
              "--project-id",
              imported.projectId,
              "--service-id",
              serviceByHostname(`${side}${primary}`).id,
              "--format",
              "JSONSTREAM",
              "--limit",
              "500",
            ],
            Object.values(input.secrets),
            input.signal,
          ),
        destroy: async (): Promise<TeardownProof> => {
          const startedAt = new Date().toISOString();
          if (await this.#projectIsAbsent(imported.projectId)) {
            return {
              startedAt,
              completedAt: new Date().toISOString(),
              providerProjectId: imported.projectId,
              deleted: true,
              message: "The exact Zerops project is absent.",
            };
          }
          if (!deletionProcessId) {
            const project = projectSchema.parse(
              await this.#request(`/project/${encodeURIComponent(imported.projectId)}`),
            );
            assertOwnedReviewProject(project, {
              projectId: imported.projectId,
              clientId: this.#options.clientId,
              description: ownershipDescription,
            });
            const process = deleteResponseSchema.parse(
              await this.#request(`/project/${encodeURIComponent(imported.projectId)}`, {
                method: "DELETE",
              }),
            );
            deletionProcessId = process.id;
          }
          await this.#waitForProcess(deletionProcessId);
          const deleted = await this.#projectIsAbsent(imported.projectId);
          return {
            startedAt,
            completedAt: new Date().toISOString(),
            providerProjectId: imported.projectId,
            deleted,
            message: deleted
              ? `Zerops deletion process ${deletionProcessId} finished and the project is absent.`
              : `Zerops deletion process ${deletionProcessId} finished but the project still resolves.`,
          };
        },
          metadata: {
            executorUrl,
            manifestHashes: JSON.stringify(
              Object.fromEntries(
                preparedDeployments.map(({ deployment, manifestSha256 }) => [
                  deployment.hostname,
                  manifestSha256,
                ]),
              ),
            ),
          },
        };
      } catch (error) {
        try {
          if (!(await this.#projectIsAbsent(imported.projectId))) {
            const project = projectSchema.parse(
              await this.#request(`/project/${encodeURIComponent(imported.projectId)}`),
            );
            assertOwnedReviewProject(project, {
              projectId: imported.projectId,
              clientId: this.#options.clientId,
              description: ownershipDescription,
            });
            const process = deleteResponseSchema.parse(
              await this.#request(`/project/${encodeURIComponent(imported.projectId)}`, {
                method: "DELETE",
              }),
            );
            await this.#waitForProcess(process.id);
          }
        } catch {
          // Preserve the provisioning error. The DB-owned orphan reaper must retry this exact ID.
        }
        throw error;
      }
    } finally {
      await Promise.all(preparedDeployments.map((prepared) => prepared.cleanup()));
    }
  }
}

export const zeropsSchemasForTest = {
  assertOwnedReviewProject,
  importResponseSchema,
  processSchema,
  serviceStackSchema,
};
