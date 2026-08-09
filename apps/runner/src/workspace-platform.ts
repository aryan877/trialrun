import { spawn } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { redactText } from "@trialrun/domain";
import {
  assertMatchesZeropsSchema,
  compileZeropsSchema,
  isZeropsProjectAbsentResponse,
} from "@trialrun/executor";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

const zeropsIdSchema = z.string().min(1).max(100);
const ownershipHashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const processSchema = z
  .object({
    id: zeropsIdSchema,
    status: z.enum([
      "PENDING",
      "RUNNING",
      "ROLLBACKING",
      "CANCELING",
      "FINISHED",
      "FAILED",
      "CANCELED",
    ]),
    clientId: zeropsIdSchema.optional(),
    projectId: zeropsIdSchema.optional(),
  })
  .passthrough();
const importResponseSchema = z.object({
  projectId: zeropsIdSchema,
  serviceStacks: z.array(
    z.object({
      id: zeropsIdSchema,
      name: z.string().min(1).max(100),
      processes: z.array(processSchema),
    }),
  ),
});
const projectSchema = z
  .object({
    id: zeropsIdSchema,
    clientId: zeropsIdSchema,
    description: z.string().nullable(),
    tagList: z.array(z.string()),
    status: z.string(),
  })
  .passthrough();
const serviceSchema = z
  .object({
    id: zeropsIdSchema,
    projectId: zeropsIdSchema,
    name: z.string().min(1).max(100),
    subdomainAccess: z.boolean(),
    userData: z
      .array(
        z
          .object({
            key: z.string().min(1).max(100),
            content: z.string().max(8_000),
          })
          .passthrough(),
      )
      .max(1_000),
  })
  .passthrough();
const workspaceImportSchema = z.strictObject({
  project: z.strictObject({
    name: z.string().min(1).max(50),
    description: z.string().min(1).max(1_000),
    corePackage: z.literal("LIGHT"),
    tags: z.tuple([z.literal("trialrun"), z.literal("codex-workspace")]),
  }),
  services: z.tuple([
    z.strictObject({
      hostname: z.literal("codexworkspace"),
      type: z.literal("zcp@1"),
      enableSubdomainAccess: z.literal(true),
      envSecrets: z.strictObject({
        TRIALRUN_BRIDGE_AUDIENCE: z.string().regex(/^agent-connection:[0-9a-f-]{36}$/),
        TRIALRUN_BRIDGE_PUBLIC_KEY_BASE64: z.base64(),
        TRIALRUN_REPOSITORY_MCP_URL: z.url(),
      }),
    }),
  ]),
});

const workspaceTags = ["trialrun", "codex-workspace"] as const;
const workspaceHostname = "codexworkspace";
const bridgePort = 8787;
const maximumApiResponseBytes = 1_000_000;

type FetchFunction = (url: string, init: RequestInit) => Promise<Response>;
type SleepFunction = (milliseconds: number, signal: AbortSignal) => Promise<void>;

export interface WorkspaceSourcePusher {
  push(input: {
    readonly projectId: string;
    readonly serviceId: string;
    readonly sourceDirectory: string;
    readonly signal: AbortSignal;
  }): Promise<void>;
}

export interface ZeropsWorkspacePlatformClientOptions {
  readonly apiUrl: string;
  readonly accessToken: string;
  readonly clientId: string;
  readonly sourceDirectory: string;
  readonly zcliBinary?: string;
  readonly operationTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly fetchFunction?: FetchFunction;
  readonly sleepFunction?: SleepFunction;
  readonly sourcePusher?: WorkspaceSourcePusher;
}

export interface WorkspaceProvisionedIdentity {
  readonly projectId: string;
  readonly serviceId: string;
  readonly bridgeUrl: string;
}

export interface WorkspaceDeletionProof {
  readonly provider: "zerops";
  readonly projectId: string;
  readonly observedAt: string;
  readonly result: "not_found";
}

interface PersistedWorkspaceIdentity {
  readonly projectId: string;
  readonly serviceId: string;
}

interface ApiResponse {
  readonly status: number;
  readonly body: unknown;
}

function ownershipDescription(connectionId: string, ownershipHash: string): string {
  return `TrialRun Codex workspace ${z.string().uuid().parse(connectionId)}; ownership-sha256=${ownershipHashSchema.parse(ownershipHash)}`;
}

function bridgeUrlFromService(service: z.infer<typeof serviceSchema>): string {
  const subdomains = service.userData.filter(({ key }) => key === "zeropsSubdomain");
  if (subdomains.length !== 1) {
    throw new Error("Zerops workspace service did not expose exactly one generated subdomain URL.");
  }
  const content = subdomains[0]?.content;
  if (!content) throw new Error("Zerops workspace service returned an empty subdomain URL.");

  let candidate: URL;
  try {
    candidate = new URL(content);
  } catch {
    throw new Error("Zerops workspace service returned an invalid generated subdomain URL.");
  }
  const firstLabel = candidate.hostname.split(".")[0];
  if (
    candidate.protocol !== "https:" ||
    candidate.username !== "" ||
    candidate.password !== "" ||
    candidate.port !== "" ||
    candidate.pathname !== "/" ||
    candidate.search !== "" ||
    candidate.hash !== "" ||
    !candidate.hostname.endsWith(".zerops.app") ||
    candidate.hostname.split(".").length < 4 ||
    !firstLabel?.startsWith(`${workspaceHostname}-`) ||
    !firstLabel.endsWith(`-${bridgePort}`)
  ) {
    throw new Error("Zerops workspace service returned an invalid generated subdomain URL.");
  }
  return candidate.origin;
}

async function readApiResponseBody(response: Response, method: string, path: string): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const bytes = Number(declaredLength);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maximumApiResponseBytes) {
      throw new Error(`Zerops API ${method} ${path} returned an invalid or oversized response.`);
    }
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximumApiResponseBytes) {
    throw new Error(`Zerops API ${method} ${path} returned an oversized response.`);
  }
  if (bytes.byteLength === 0) return {};

  try {
    const parsed: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
    return parsed;
  } catch {
    throw new Error(`Zerops API ${method} ${path} returned invalid JSON.`);
  }
}

function defaultSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolveDelay, rejectDelay) => {
    const timeout = setTimeout(resolveDelay, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        rejectDelay(
          signal.reason instanceof Error
            ? signal.reason
            : new Error("Zerops workspace polling aborted."),
        );
      },
      { once: true },
    );
  });
}

class ZcliWorkspaceSourcePusher implements WorkspaceSourcePusher {
  readonly #accessToken: string;
  readonly #binary: string;
  readonly #timeoutMs: number;

  constructor(accessToken: string, binary: string, timeoutMs: number) {
    this.#accessToken = accessToken;
    this.#binary = binary;
    this.#timeoutMs = timeoutMs;
  }

  async push(input: {
    readonly projectId: string;
    readonly serviceId: string;
    readonly sourceDirectory: string;
    readonly signal: AbortSignal;
  }): Promise<void> {
    const isolatedDirectory = await mkdtemp(join(tmpdir(), "trialrun-workspace-zcli-"));
    try {
      await new Promise<void>((resolveProcess, rejectProcess) => {
        const child = spawn(
          this.#binary,
          [
            "service",
            "push",
            "--project-id",
            input.projectId,
            "--service-id",
            input.serviceId,
            "--setup",
            "codexworkspace",
            "--working-dir",
            input.sourceDirectory,
            "--zerops-yaml-path",
            join(input.sourceDirectory, "zerops.yaml"),
            "--no-git",
            "--disable-logs",
          ],
          {
            env: {
              PATH: process.env.PATH,
              LANG: process.env.LANG ?? "C.UTF-8",
              ZEROPS_TOKEN: this.#accessToken,
              ZEROPS_CLI_TERMINAL_MODE: "disabled",
              ZEROPS_CLI_DATA_FILE_PATH: join(isolatedDirectory, "cli.data"),
              ZEROPS_CLI_LOG_FILE_PATH: join(isolatedDirectory, "zcli.log"),
              ZEROPS_CLI_YAML_FILE_PATH: join(isolatedDirectory, "zcli.yml"),
            },
            stdio: ["ignore", "ignore", "pipe"],
            timeout: this.#timeoutMs,
            killSignal: "SIGTERM",
            signal: input.signal,
          },
        );
        let stderr = "";
        child.stderr.on("data", (chunk: Buffer) => {
          stderr = `${stderr}${chunk.toString("utf8")}`.slice(-20_000);
        });
        child.once("error", rejectProcess);
        child.once("exit", (code, exitSignal) => {
          if (code === 0) resolveProcess();
          else {
            rejectProcess(
              new Error(
                `Workspace zCLI push exited with ${code ?? exitSignal}: ${redactText(stderr, [this.#accessToken])}`,
              ),
            );
          }
        });
      });
    } finally {
      await rm(isolatedDirectory, { recursive: true, force: true });
    }
  }
}

export class ZeropsWorkspacePlatformClient {
  readonly #accessToken: string;
  readonly #apiUrl: string;
  readonly #clientId: string;
  readonly #fetch: FetchFunction;
  readonly #operationTimeoutMs: number;
  readonly #pollIntervalMs: number;
  readonly #requestTimeoutMs: number;
  readonly #sleep: SleepFunction;
  readonly #sourceDirectory: string;
  readonly #sourcePusher: WorkspaceSourcePusher;

  constructor(options: ZeropsWorkspacePlatformClientOptions) {
    const apiUrl = new URL(options.apiUrl);
    if (
      apiUrl.protocol !== "https:" ||
      apiUrl.hostname !== "api.app-prg1.zerops.io" ||
      apiUrl.pathname.replace(/\/$/, "") !== "/api/rest/public"
    ) {
      throw new Error("Codex workspaces require the pinned official Zerops Prague API.");
    }
    this.#apiUrl = options.apiUrl.replace(/\/$/, "");
    this.#accessToken = z.string().min(1).max(4_000).parse(options.accessToken);
    this.#clientId = zeropsIdSchema.parse(options.clientId);
    this.#sourceDirectory = resolve(options.sourceDirectory);
    this.#operationTimeoutMs = z
      .number()
      .int()
      .min(30_000)
      .max(3_600_000)
      .parse(options.operationTimeoutMs ?? 15 * 60_000);
    this.#requestTimeoutMs = z
      .number()
      .int()
      .min(1_000)
      .max(60_000)
      .parse(options.requestTimeoutMs ?? 30_000);
    this.#pollIntervalMs = z
      .number()
      .int()
      .min(10)
      .max(30_000)
      .parse(options.pollIntervalMs ?? 2_000);
    this.#fetch = options.fetchFunction ?? fetch;
    this.#sleep = options.sleepFunction ?? defaultSleep;
    this.#sourcePusher =
      options.sourcePusher ??
      new ZcliWorkspaceSourcePusher(
        this.#accessToken,
        options.zcliBinary ?? "zcli",
        this.#operationTimeoutMs,
      );
  }

  async provision(input: {
    readonly connectionId: string;
    readonly ownershipHash: string;
    readonly bridgePublicKeyBase64: string;
    readonly repositoryMcpUrl: string;
    readonly existing?: PersistedWorkspaceIdentity;
    readonly onCreated: (identity: PersistedWorkspaceIdentity) => Promise<void>;
    readonly signal?: AbortSignal;
  }): Promise<WorkspaceProvisionedIdentity> {
    const connectionId = z.string().uuid().parse(input.connectionId);
    const ownershipHash = ownershipHashSchema.parse(input.ownershipHash);
    const description = ownershipDescription(connectionId, ownershipHash);
    const operationSignal = input.signal
      ? AbortSignal.any([input.signal, AbortSignal.timeout(this.#operationTimeoutMs)])
      : AbortSignal.timeout(this.#operationTimeoutMs);
    const sourceDirectory = await realpath(this.#sourceDirectory);
    let identity = input.existing;
    if (!identity) {
      const importDefinition = workspaceImportSchema.parse({
        project: {
          name: `trialrun-codex-${connectionId.slice(0, 8)}`,
          description,
          corePackage: "LIGHT",
          tags: [...workspaceTags],
        },
        services: [
          {
            hostname: workspaceHostname,
            type: "zcp@1",
            enableSubdomainAccess: true,
            envSecrets: {
              TRIALRUN_BRIDGE_AUDIENCE: `agent-connection:${connectionId}`,
              TRIALRUN_BRIDGE_PUBLIC_KEY_BASE64: z.base64().parse(input.bridgePublicKeyBase64),
              TRIALRUN_REPOSITORY_MCP_URL: z.url().parse(input.repositoryMcpUrl),
            },
          },
        ],
      });
      assertMatchesZeropsSchema(
        compileZeropsSchema(
          (
            await this.#request(
              "/settings/import-project-yml-json-schema.json",
              "GET",
              operationSignal,
            )
          ).body,
        ),
        importDefinition,
        "Generated Codex workspace project import",
      );
      const yaml = stringifyYaml(importDefinition);
      if (Buffer.byteLength(yaml, "utf8") > 100_000) {
        throw new Error("Generated Codex workspace import exceeds the Zerops size limit.");
      }
      const imported = importResponseSchema.parse(
        (
          await this.#request(
            `/client/${encodeURIComponent(this.#clientId)}/project/import`,
            "POST",
            operationSignal,
            { yaml },
          )
        ).body,
      );
      const service = imported.serviceStacks.find(({ name }) => name === workspaceHostname);
      if (!service || imported.serviceStacks.length !== 1) {
        throw new Error("Zerops workspace import did not return the exact requested ZCP service.");
      }
      identity = { projectId: imported.projectId, serviceId: service.id };
      const createdIdentity = identity;
      try {
        await input.onCreated(createdIdentity);
      } catch (persistenceError) {
        try {
          await this.deleteExact({
            connectionId,
            projectId: createdIdentity.projectId,
            ownershipHash,
            signal: operationSignal,
          });
        } catch {
          // Preserve the persistence failure; the exact best-effort rollback was attempted.
        }
        throw persistenceError;
      }
      await Promise.all(
        imported.serviceStacks.flatMap(({ processes }) =>
          processes.map(({ id }) => this.#waitForProcess(id, createdIdentity, operationSignal)),
        ),
      );
    }

    if (!identity) throw new Error("Zerops workspace identity was not established.");

    const project = await this.#getOwnedProject(identity.projectId, description, operationSignal);
    if (!project) throw new Error("The persisted Zerops Codex workspace project is absent.");
    await this.#getWorkspaceService(identity, operationSignal);
    await this.#sourcePusher.push({
      projectId: identity.projectId,
      serviceId: identity.serviceId,
      sourceDirectory,
      signal: operationSignal,
    });
    const enableProcess = processSchema.parse(
      (
        await this.#request(
          `/service-stack/${encodeURIComponent(identity.serviceId)}/enable-subdomain-access`,
          "PUT",
          operationSignal,
        )
      ).body,
    );
    await this.#waitForProcess(enableProcess.id, identity, operationSignal);
    const publicService = await this.#waitForSubdomainAccess(identity, operationSignal);
    const bridgeUrl = bridgeUrlFromService(publicService);
    await this.#waitForHealth(bridgeUrl, operationSignal);
    return { ...identity, bridgeUrl };
  }

  async deleteExact(input: {
    readonly connectionId: string;
    readonly projectId: string;
    readonly ownershipHash: string;
    readonly signal?: AbortSignal;
  }): Promise<WorkspaceDeletionProof> {
    const projectId = zeropsIdSchema.parse(input.projectId);
    const description = ownershipDescription(input.connectionId, input.ownershipHash);
    const operationSignal = input.signal
      ? AbortSignal.any([input.signal, AbortSignal.timeout(this.#operationTimeoutMs)])
      : AbortSignal.timeout(this.#operationTimeoutMs);
    const project = await this.#getOwnedProject(projectId, description, operationSignal);
    if (project) {
      if (project.status !== "DELETING") {
        const deletion = await this.#request(
          `/project/${encodeURIComponent(projectId)}`,
          "DELETE",
          operationSignal,
        );
        if (!isZeropsProjectAbsentResponse(deletion.status, deletion.body)) {
          const process = processSchema.parse(deletion.body);
          await this.#waitForProcess(process.id, { projectId, serviceId: "deletion" }, operationSignal);
        }
      }
      while (await this.#getOwnedProject(projectId, description, operationSignal)) {
        await this.#sleep(this.#pollIntervalMs, operationSignal);
      }
    }
    return {
      provider: "zerops",
      projectId,
      observedAt: new Date().toISOString(),
      result: "not_found",
    };
  }

  async #request(
    path: string,
    method: "GET" | "POST" | "PUT" | "DELETE",
    signal: AbortSignal,
    body?: object,
  ): Promise<ApiResponse> {
    signal.throwIfAborted();
    const response = await this.#fetch(`${this.#apiUrl}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.#accessToken}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.any([signal, AbortSignal.timeout(this.#requestTimeoutMs)]),
    });
    const parsedBody = await readApiResponseBody(response, method, path);
    if (!response.ok && !isZeropsProjectAbsentResponse(response.status, parsedBody)) {
      throw new Error(`Zerops API ${method} ${path} returned HTTP ${response.status}.`);
    }
    return { status: response.status, body: parsedBody };
  }

  async #getOwnedProject(
    projectId: string,
    description: string,
    signal: AbortSignal,
  ): Promise<z.infer<typeof projectSchema> | null> {
    const response = await this.#request(
      `/project/${encodeURIComponent(projectId)}`,
      "GET",
      signal,
    );
    if (isZeropsProjectAbsentResponse(response.status, response.body)) return null;
    const project = projectSchema.parse(response.body);
    if (
      project.id !== projectId ||
      project.clientId !== this.#clientId ||
      project.description !== description ||
      !workspaceTags.every((tag) => project.tagList.includes(tag))
    ) {
      throw new Error("Zerops Codex workspace ownership does not match; the operation was refused.");
    }
    return project;
  }

  async #getWorkspaceService(
    identity: PersistedWorkspaceIdentity,
    signal: AbortSignal,
  ): Promise<z.infer<typeof serviceSchema>> {
    const service = serviceSchema.parse(
      (
        await this.#request(
          `/service-stack/${encodeURIComponent(identity.serviceId)}`,
          "GET",
          signal,
        )
      ).body,
    );
    if (
      service.id !== identity.serviceId ||
      service.projectId !== identity.projectId ||
      service.name !== workspaceHostname
    ) {
      throw new Error("The persisted Zerops Codex workspace service identity is invalid.");
    }
    return service;
  }

  async #waitForSubdomainAccess(
    identity: PersistedWorkspaceIdentity,
    signal: AbortSignal,
  ): Promise<z.infer<typeof serviceSchema>> {
    while (true) {
      const service = await this.#getWorkspaceService(identity, signal);
      if (service.subdomainAccess) return service;
      await this.#sleep(this.#pollIntervalMs, signal);
    }
  }

  async #waitForProcess(
    processId: string,
    identity: PersistedWorkspaceIdentity,
    signal: AbortSignal,
  ): Promise<void> {
    while (true) {
      const response = await this.#request(
        `/process/${encodeURIComponent(processId)}`,
        "GET",
        signal,
      );
      if (response.status === 404) throw new Error("Zerops process disappeared before completion.");
      const process = processSchema.parse(response.body);
      if (process.id !== processId) throw new Error("Zerops returned a different process ID.");
      if (process.clientId && process.clientId !== this.#clientId) {
        throw new Error("Zerops process belongs to another client.");
      }
      if (process.projectId && process.projectId !== identity.projectId) {
        throw new Error("Zerops process belongs to another project.");
      }
      if (process.status === "FINISHED") return;
      if (process.status === "FAILED" || process.status === "CANCELED") {
        throw new Error(`Zerops process ended as ${process.status}.`);
      }
      await this.#sleep(this.#pollIntervalMs, signal);
    }
  }

  async #waitForHealth(bridgeUrl: string, signal: AbortSignal): Promise<void> {
    while (true) {
      signal.throwIfAborted();
      try {
        const response = await this.#fetch(`${bridgeUrl}/health`, {
          headers: { Accept: "application/json" },
          redirect: "error",
          signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
        });
        if (response.ok) return;
      } catch (error) {
        if (signal.aborted) throw error;
      }
      await this.#sleep(this.#pollIntervalMs, signal);
    }
  }
}

export const workspacePlatformInternals = {
  bridgeUrlFromService,
  ownershipDescription,
  workspaceTags,
} as const;
