import { setTimeout as sleep } from "node:timers/promises";

import {
  claimNextZeropsCleanup,
  completeZeropsCleanup,
  failZeropsCleanup,
  type TrialRunDatabase,
  type ZeropsCleanupClaim,
  type ZeropsCleanupFailure,
  type ZeropsCleanupProof,
} from "@trialrun/db";
import { redactText } from "@trialrun/domain";
import { isZeropsProjectAbsentResponse } from "@trialrun/executor";
import { z } from "zod";

const zeropsIdSchema = z.string().min(1).max(100);
const ownershipHashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const projectSchema = z
  .object({
    id: zeropsIdSchema,
    clientId: zeropsIdSchema,
    description: z.string().nullable(),
    status: z.enum([
      "NEW",
      "CREATING",
      "ACTIVE",
      "DELETING",
      "FAILED",
      "STOPPING",
      "STOPPED",
      "STARTING",
    ]),
  })
  .passthrough();
const processSchema = z
  .object({
    id: zeropsIdSchema,
    clientId: zeropsIdSchema,
    projectId: zeropsIdSchema,
    status: z.enum([
      "PENDING",
      "RUNNING",
      "ROLLBACKING",
      "CANCELING",
      "FINISHED",
      "FAILED",
      "CANCELED",
    ]),
    actionName: z.string().optional(),
  })
  .passthrough();
const clientOptionsSchema = z.object({
  apiUrl: z.string().url(),
  accessToken: z.string().min(1).max(4_000),
  clientId: zeropsIdSchema,
  requestTimeoutMs: z.number().int().min(100).max(60_000),
  operationTimeoutMs: z.number().int().min(1_000).max(3_600_000),
  pollIntervalMs: z.number().int().min(10).max(30_000),
});

type FetchFunction = (url: string, init: RequestInit) => Promise<Response>;
type SleepFunction = (milliseconds: number, signal: AbortSignal) => Promise<void>;

interface ApiResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface ZeropsCleanupClientOptions {
  readonly apiUrl: string;
  readonly accessToken: string;
  readonly clientId: string;
  readonly requestTimeoutMs?: number;
  readonly operationTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly fetchFunction?: FetchFunction;
  readonly sleepFunction?: SleepFunction;
}

export interface ExactZeropsProjectDeleter {
  deleteClaimedProject(
    claim: ZeropsCleanupClaim,
    signal?: AbortSignal,
  ): Promise<ZeropsCleanupProof>;
}

export function zeropsCleanupOwnershipDescription(reviewId: string, ownershipHash: string): string {
  const validReviewId = z.string().uuid().parse(reviewId);
  const validOwnershipHash = ownershipHashSchema.parse(ownershipHash);
  return `TrialRun review ${validReviewId}; ownership-sha256=${validOwnershipHash}`;
}

function defaultSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return sleep(milliseconds, undefined, { signal });
}

export class ZeropsCleanupClient implements ExactZeropsProjectDeleter {
  readonly #apiUrl: string;
  readonly #accessToken: string;
  readonly #clientId: string;
  readonly #requestTimeoutMs: number;
  readonly #operationTimeoutMs: number;
  readonly #pollIntervalMs: number;
  readonly #fetch: FetchFunction;
  readonly #sleep: SleepFunction;

  constructor(options: ZeropsCleanupClientOptions) {
    const parsed = clientOptionsSchema.parse({
      apiUrl: options.apiUrl,
      accessToken: options.accessToken,
      clientId: options.clientId,
      requestTimeoutMs: options.requestTimeoutMs ?? 30_000,
      operationTimeoutMs: options.operationTimeoutMs ?? 10 * 60_000,
      pollIntervalMs: options.pollIntervalMs ?? 2_000,
    });
    const apiUrl = new URL(parsed.apiUrl);
    if (
      apiUrl.protocol !== "https:" &&
      apiUrl.hostname !== "localhost" &&
      apiUrl.hostname !== "127.0.0.1" &&
      apiUrl.hostname !== "::1"
    ) {
      throw new Error("Zerops API credentials require HTTPS outside loopback development.");
    }
    this.#apiUrl = parsed.apiUrl.replace(/\/$/, "");
    this.#accessToken = parsed.accessToken;
    this.#clientId = parsed.clientId;
    this.#requestTimeoutMs = parsed.requestTimeoutMs;
    this.#operationTimeoutMs = parsed.operationTimeoutMs;
    this.#pollIntervalMs = parsed.pollIntervalMs;
    this.#fetch = options.fetchFunction ?? fetch;
    this.#sleep = options.sleepFunction ?? defaultSleep;
  }

  async #request(
    path: string,
    method: "GET" | "DELETE",
    signal: AbortSignal,
  ): Promise<ApiResponse> {
    signal.throwIfAborted();
    const response = await this.#fetch(`${this.#apiUrl}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.#accessToken}`,
      },
      signal: AbortSignal.any([signal, AbortSignal.timeout(this.#requestTimeoutMs)]),
    });
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > 1_000_000) {
      throw new Error(`Zerops API ${method} ${path} returned an oversized response.`);
    }
    if (text.length === 0) {
      if (!response.ok && response.status !== 404) {
        throw new Error(`Zerops API ${method} ${path} returned HTTP ${response.status}.`);
      }
      return { status: response.status, body: null };
    }
    try {
      const body: unknown = JSON.parse(text);
      if (!response.ok && !isZeropsProjectAbsentResponse(response.status, body)) {
        throw new Error(`Zerops API ${method} ${path} returned HTTP ${response.status}.`);
      }
      return { status: response.status, body };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Zerops API ")) throw error;
      throw new Error(`Zerops API ${method} ${path} returned invalid JSON.`);
    }
  }

  #assertExactProject(
    project: z.infer<typeof projectSchema>,
    claim: ZeropsCleanupClaim,
    expectedDescription: string,
  ): void {
    if (project.id !== claim.providerProjectId) {
      throw new Error("Zerops returned a different project ID; cleanup was refused.");
    }
    if (project.clientId !== this.#clientId) {
      throw new Error(
        "The claimed Zerops project belongs to a different client; cleanup was refused.",
      );
    }
    if (project.description !== expectedDescription) {
      throw new Error(
        "The claimed Zerops project ownership marker does not match; cleanup was refused.",
      );
    }
  }

  #assertExactProcess(process: z.infer<typeof processSchema>, claim: ZeropsCleanupClaim): void {
    if (process.clientId !== this.#clientId || process.projectId !== claim.providerProjectId) {
      throw new Error("Zerops returned a process for a different client or project.");
    }
  }

  async #getProject(
    claim: ZeropsCleanupClaim,
    expectedDescription: string,
    signal: AbortSignal,
  ): Promise<z.infer<typeof projectSchema> | null> {
    const response = await this.#request(
      `/project/${encodeURIComponent(claim.providerProjectId)}`,
      "GET",
      signal,
    );
    if (isZeropsProjectAbsentResponse(response.status, response.body)) return null;
    const project = projectSchema.parse(response.body);
    this.#assertExactProject(project, claim, expectedDescription);
    return project;
  }

  async #pause(deadline: number, signal: AbortSignal): Promise<void> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Timed out waiting for exact Zerops project deletion.");
    await this.#sleep(Math.min(this.#pollIntervalMs, remaining), signal);
  }

  async #waitForProcess(
    initial: z.infer<typeof processSchema>,
    claim: ZeropsCleanupClaim,
    deadline: number,
    signal: AbortSignal,
  ): Promise<void> {
    const processId = initial.id;
    let process = initial;
    while (true) {
      this.#assertExactProcess(process, claim);
      if (process.id !== processId) {
        throw new Error("Zerops returned a different deletion process ID.");
      }
      if (process.status === "FINISHED") return;
      if (process.status === "FAILED" || process.status === "CANCELED") {
        throw new Error(`Zerops deletion process ${process.id} ended as ${process.status}.`);
      }
      await this.#pause(deadline, signal);
      const response = await this.#request(
        `/process/${encodeURIComponent(processId)}`,
        "GET",
        signal,
      );
      if (isZeropsProjectAbsentResponse(response.status, response.body)) {
        throw new Error("The exact Zerops deletion process disappeared before completion.");
      }
      process = processSchema.parse(response.body);
    }
  }

  async #waitForAbsence(
    claim: ZeropsCleanupClaim,
    expectedDescription: string,
    deadline: number,
    signal: AbortSignal,
  ): Promise<void> {
    while (await this.#getProject(claim, expectedDescription, signal)) {
      await this.#pause(deadline, signal);
    }
  }

  async deleteClaimedProject(
    claim: ZeropsCleanupClaim,
    signal?: AbortSignal,
  ): Promise<ZeropsCleanupProof> {
    const projectId = zeropsIdSchema.parse(claim.providerProjectId);
    const ownershipHash = ownershipHashSchema.parse(claim.providerOwnershipTokenHash);
    const expectedDescription = zeropsCleanupOwnershipDescription(claim.reviewId, ownershipHash);
    const startedAt = new Date().toISOString();
    const operationSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(this.#operationTimeoutMs)])
      : AbortSignal.timeout(this.#operationTimeoutMs);
    const deadline = Date.now() + this.#operationTimeoutMs;
    const initialProject = await this.#getProject(claim, expectedDescription, operationSignal);
    if (!initialProject) {
      return {
        startedAt,
        completedAt: new Date().toISOString(),
        providerProjectId: projectId,
        deleted: true,
        message: "The exact Zerops API returned projectNotFound for this persisted project ID.",
      };
    }

    let deletionProcessId: string | null = null;
    if (initialProject.status !== "DELETING") {
      const response = await this.#request(
        `/project/${encodeURIComponent(projectId)}`,
        "DELETE",
        operationSignal,
      );
      if (isZeropsProjectAbsentResponse(response.status, response.body)) {
        return {
          startedAt,
          completedAt: new Date().toISOString(),
          providerProjectId: projectId,
          deleted: true,
          message: "The exact Zerops project became absent before deletion began.",
        };
      }
      const process = processSchema.parse(response.body);
      this.#assertExactProcess(process, claim);
      deletionProcessId = process.id;
      await this.#waitForProcess(process, claim, deadline, operationSignal);
    }
    await this.#waitForAbsence(claim, expectedDescription, deadline, operationSignal);
    return {
      startedAt,
      completedAt: new Date().toISOString(),
      providerProjectId: projectId,
      deleted: true,
      message: deletionProcessId
        ? `Zerops deletion process ${deletionProcessId} finished and the exact project is absent.`
        : "The exact Zerops project was already deleting and is now absent.",
    };
  }
}

export interface ZeropsCleanupStore {
  claim(claimantId: string, leaseSeconds: number): Promise<ZeropsCleanupClaim | null>;
  complete(claim: ZeropsCleanupClaim, proof: ZeropsCleanupProof): Promise<boolean>;
  fail(claim: ZeropsCleanupClaim, error: string): Promise<ZeropsCleanupFailure | null>;
}

export function createDatabaseZeropsCleanupStore(db: TrialRunDatabase): ZeropsCleanupStore {
  return {
    claim: (claimantId, leaseSeconds) => claimNextZeropsCleanup(db, claimantId, leaseSeconds),
    complete: (claim, proof) => completeZeropsCleanup(db, claim, proof),
    fail: (claim, error) => failZeropsCleanup(db, claim, error),
  };
}

export type ZeropsCleanupRunResult = "idle" | "completed" | "failed" | "exhausted" | "stale";

export interface ZeropsCleanupWorkerOptions {
  readonly store: ZeropsCleanupStore;
  readonly deleter: ExactZeropsProjectDeleter;
  readonly claimantId: string;
  readonly leaseSeconds: number;
  readonly pollIntervalMs?: number;
  readonly redactionValues?: readonly string[];
  readonly sleepFunction?: SleepFunction;
  readonly logError?: (message: string) => void;
}

export class ZeropsCleanupWorker {
  readonly #store: ZeropsCleanupStore;
  readonly #deleter: ExactZeropsProjectDeleter;
  readonly #claimantId: string;
  readonly #leaseSeconds: number;
  readonly #pollIntervalMs: number;
  readonly #redactionValues: readonly string[];
  readonly #sleep: SleepFunction;
  readonly #logError: (message: string) => void;

  constructor(options: ZeropsCleanupWorkerOptions) {
    this.#store = options.store;
    this.#deleter = options.deleter;
    this.#claimantId = z.string().trim().min(1).max(160).parse(options.claimantId);
    this.#leaseSeconds = z.number().int().min(30).max(900).parse(options.leaseSeconds);
    this.#pollIntervalMs = z
      .number()
      .int()
      .min(100)
      .max(300_000)
      .parse(options.pollIntervalMs ?? 30_000);
    this.#redactionValues = options.redactionValues ?? [];
    this.#sleep = options.sleepFunction ?? defaultSleep;
    this.#logError = options.logError ?? (() => undefined);
  }

  #safeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return redactText(message, this.#redactionValues).slice(0, 8_000);
  }

  async runOnce(signal?: AbortSignal): Promise<ZeropsCleanupRunResult> {
    signal?.throwIfAborted();
    const claim = await this.#store.claim(this.#claimantId, this.#leaseSeconds);
    if (!claim) return "idle";
    try {
      const proof = await this.#deleter.deleteClaimedProject(claim, signal);
      return (await this.#store.complete(claim, proof)) ? "completed" : "stale";
    } catch (error) {
      const result = await this.#store.fail(claim, this.#safeError(error));
      if (!result) return "stale";
      return result.exhausted ? "exhausted" : "failed";
    }
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        await this.runOnce(signal);
      } catch (error) {
        this.#logError(this.#safeError(error));
      }
      if (signal.aborted) return;
      try {
        await this.#sleep(this.#pollIntervalMs, signal);
      } catch (error) {
        if (signal.aborted) return;
        this.#logError(this.#safeError(error));
      }
    }
  }
}
