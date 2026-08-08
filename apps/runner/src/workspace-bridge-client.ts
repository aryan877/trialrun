import {
  createHash,
  createPrivateKey,
  randomBytes,
  sign,
  type KeyObject,
} from "node:crypto";

import {
  workspaceInvocationAcceptedSchema,
  workspaceInvocationRequestSchema,
  workspaceInvocationStatusSchema,
  workspaceProbeResultSchema,
  type WorkspaceInvocationRequest,
  type WorkspaceInvocationResult,
} from "@trialrun/agent-runtime";
import { z } from "zod";

const deviceLoginStateSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("idle") }),
  z.strictObject({
    status: z.literal("awaiting_auth"),
    verificationUri: z.literal("https://auth.openai.com/codex/device"),
    userCode: z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4,8}$/),
    expiresAt: z.string().datetime({ offset: true }),
  }),
  z.strictObject({ status: z.literal("connected") }),
  z.strictObject({
    status: z.literal("failed"),
    errorCode: z.enum(["login_failed", "login_expired"]),
  }),
]);

const loggedOutSchema = z.strictObject({ status: z.literal("logged_out") });
const bridgeHealthSchema = z.strictObject({ status: z.literal("ready") });
const maximumResponseBytes = 4 * 1_024 * 1_024;

export interface WorkspaceBridgeClientOptions {
  readonly bridgeUrl: string;
  readonly connectionId: string;
  readonly signingPrivateKeyBase64: string;
  readonly requestTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly fetchFunction?: typeof fetch;
  readonly sleepFunction?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

function bridgeBaseUrl(value: string): string {
  const url = new URL(value);
  const canonicalInput = value.endsWith("/") ? value : `${value}/`;
  if (
    url.href !== canonicalInput ||
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".zerops.app") ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error("Codex workspace bridge must be an exact HTTPS Zerops service URL.");
  }
  return url.href.slice(0, -1);
}

function parseSigningKey(value: string): KeyObject {
  const decoded = Buffer.from(z.base64().parse(value), "base64");
  const key = decoded.toString("utf8").startsWith("-----BEGIN PRIVATE KEY-----")
    ? createPrivateKey(decoded)
    : createPrivateKey({ key: decoded, format: "der", type: "pkcs8" });
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("Workspace bridge signing requires an Ed25519 private key.");
  }
  return key;
}

function requestSigningPayload(input: {
  readonly audience: string;
  readonly method: string;
  readonly pathname: string;
  readonly timestamp: number;
  readonly nonce: string;
  readonly body: Uint8Array;
}): Uint8Array {
  const bodyHash = createHash("sha256").update(input.body).digest("hex");
  return Buffer.from(
    [
      input.audience,
      input.method.toUpperCase(),
      input.pathname,
      String(input.timestamp),
      input.nonce,
      bodyHash,
    ].join("\n"),
    "utf8",
  );
}

function defaultSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolveDelay, rejectDelay) => {
    const timeout = setTimeout(resolveDelay, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        rejectDelay(
          signal.reason instanceof Error ? signal.reason : new Error("Workspace polling aborted."),
        );
      },
      { once: true },
    );
  });
}

async function readJson(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const bytes = Number(declaredLength);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maximumResponseBytes) {
      throw new Error("Codex workspace bridge returned an invalid or oversized response.");
    }
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximumResponseBytes) {
    throw new Error("Codex workspace bridge returned an oversized response.");
  }
  const parsed: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
  return parsed;
}

export class WorkspaceBridgeClient {
  readonly #audience: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #pollIntervalMs: number;
  readonly #privateKey: KeyObject;
  readonly #requestTimeoutMs: number;
  readonly #sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;

  constructor(options: WorkspaceBridgeClientOptions) {
    const connectionId = z.string().uuid().parse(options.connectionId);
    this.#audience = `agent-connection:${connectionId}`;
    this.#baseUrl = bridgeBaseUrl(options.bridgeUrl);
    this.#privateKey = parseSigningKey(options.signingPrivateKeyBase64);
    this.#requestTimeoutMs = z
      .number()
      .int()
      .min(1_000)
      .max(120_000)
      .parse(options.requestTimeoutMs ?? 30_000);
    this.#pollIntervalMs = z
      .number()
      .int()
      .min(50)
      .max(10_000)
      .parse(options.pollIntervalMs ?? 2_000);
    this.#fetch = options.fetchFunction ?? fetch;
    this.#sleep = options.sleepFunction ?? defaultSleep;
  }

  async health(signal?: AbortSignal): Promise<void> {
    const response = await this.#fetch(`${this.#baseUrl}/health`, {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(this.#requestTimeoutMs)])
        : AbortSignal.timeout(this.#requestTimeoutMs),
    });
    if (!response.ok) throw new Error(`Codex workspace health returned HTTP ${response.status}.`);
    bridgeHealthSchema.parse(await readJson(response));
  }

  async startLogin(signal?: AbortSignal) {
    return deviceLoginStateSchema.parse(await this.#request("POST", "/v1/login/start", undefined, signal));
  }

  async loginStatus(signal?: AbortSignal) {
    return deviceLoginStateSchema.parse(await this.#request("GET", "/v1/login/status", undefined, signal));
  }

  async probe(signal?: AbortSignal) {
    return workspaceProbeResultSchema.parse(await this.#request("POST", "/v1/probe", undefined, signal));
  }

  async logout(signal?: AbortSignal): Promise<void> {
    loggedOutSchema.parse(await this.#request("POST", "/v1/logout", undefined, signal));
  }

  async invoke(
    rawRequest: WorkspaceInvocationRequest,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<WorkspaceInvocationResult> {
    const request = workspaceInvocationRequestSchema.parse(rawRequest);
    const accepted = workspaceInvocationAcceptedSchema.parse(
      await this.#request("POST", "/v1/invocations", request, signal),
    );
    const timeoutSignal = AbortSignal.timeout(
      z.number().int().min(5_000).max(3_600_000).parse(timeoutMs),
    );
    const operationSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    try {
      while (true) {
        operationSignal.throwIfAborted();
        const status = workspaceInvocationStatusSchema.parse(
          await this.#request(
            "GET",
            `/v1/invocations/${encodeURIComponent(accepted.invocationId)}`,
            undefined,
            operationSignal,
          ),
        );
        if (status.status === "succeeded") return status.result;
        if (status.status === "failed") {
          throw new Error(`Codex workspace invocation failed with ${status.errorCode}.`);
        }
        await this.#sleep(this.#pollIntervalMs, operationSignal);
      }
    } catch (error) {
      try {
        await this.#request(
          "DELETE",
          `/v1/invocations/${encodeURIComponent(accepted.invocationId)}`,
        );
      } catch {
        // The bounded invocation is already terminal or the workspace is unavailable.
      }
      throw error;
    }
  }

  async #request(
    method: "GET" | "POST" | "DELETE",
    pathname: string,
    value?: object,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const body = value === undefined ? new Uint8Array() : Buffer.from(JSON.stringify(value), "utf8");
    const timestamp = Math.floor(Date.now() / 1_000);
    const nonce = randomBytes(16).toString("hex");
    const payload = requestSigningPayload({
      audience: this.#audience,
      method,
      pathname,
      timestamp,
      nonce,
      body,
    });
    const signature = sign(null, payload, this.#privateKey).toString("base64");
    const response = await this.#fetch(`${this.#baseUrl}${pathname}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(value === undefined ? {} : { "Content-Type": "application/json" }),
        "x-trialrun-audience": this.#audience,
        "x-trialrun-nonce": nonce,
        "x-trialrun-signature": signature,
        "x-trialrun-timestamp": String(timestamp),
      },
      ...(value === undefined ? {} : { body }),
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(this.#requestTimeoutMs)])
        : AbortSignal.timeout(this.#requestTimeoutMs),
    });
    if (!response.ok) {
      throw new Error(
        `Codex workspace bridge ${method} ${pathname} returned HTTP ${response.status}.`,
      );
    }
    return readJson(response);
  }
}

export const workspaceBridgeClientInternals = { bridgeBaseUrl, parseSigningKey } as const;
