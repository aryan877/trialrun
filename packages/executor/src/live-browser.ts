import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  redactText,
  testAssertionSchema,
  testInputValueSchema,
  testLocatorSchema,
  testNavigationWaitUntilSchema,
  testPressKeySchema,
  testSelectOptionSchema,
  type BrowserEvent,
  type TestAssertion,
  type TestInputValue,
  type TestLocator,
  type TestNavigationWaitUntil,
  type TestPressKey,
  type TestSelectOption,
} from "@trialrun/domain";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type Video,
} from "playwright";
import { z } from "zod";

import {
  LiveApiContractError,
  evaluateLiveApiAssertion,
  liveApiAssertionSchema,
  liveApiRequestSchema,
  redactLiveApiText,
  resolveLiveApiRequest,
  type LiveApiAssertion,
  type LiveApiRequest,
  type ResolvedLiveApiRequest,
} from "./live-api";
import { maximumLiveBrowserRecordingArtifactBytes } from "./live-protocol";
import type { ReviewSide } from "./types";

export type LiveFillValue = TestInputValue;
export type LiveSelectOption = TestSelectOption;
export type LivePressKey = TestPressKey;
export type LiveAssertion = TestAssertion;
export type LiveNavigationWaitUntil = TestNavigationWaitUntil;

export type LiveBrowserErrorCode =
  | "ACTION_BUDGET_EXHAUSTED"
  | "ARTIFACT_LIMIT"
  | "CANCELLED"
  | "INVALID_CURSOR"
  | "INVALID_INPUT"
  | "LOCATOR_NOT_UNIQUE"
  | "SAME_ORIGIN_REQUIRED"
  | "SECRET_NOT_APPROVED"
  | "SESSION_SEALED"
  | "STALE_OBSERVATION"
  | "TIME_BUDGET_EXHAUSTED"
  | "TOOL_TIMEOUT";

export class LiveBrowserError extends Error {
  readonly code: LiveBrowserErrorCode;

  constructor(code: LiveBrowserErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LiveBrowserError";
    this.code = code;
  }
}

export interface LiveBrowserBudgets {
  readonly maxActions: number;
  readonly maxDurationMs: number;
  readonly maxCheckpoints: number;
  readonly maxResets: number;
  readonly toolTimeoutMs: number;
  readonly maxSnapshotBytes: number;
  readonly maxEventsPerRead: number;
  readonly maxApiResponseBytes: number;
  readonly maxArtifactBytes: number;
  readonly maxTotalArtifactBytes: number;
}

const defaultBudgets: LiveBrowserBudgets = {
  maxActions: 200,
  maxDurationMs: 15 * 60_000,
  maxCheckpoints: 12,
  maxResets: 4,
  toolTimeoutMs: 30_000,
  maxSnapshotBytes: 64 * 1_024,
  maxEventsPerRead: 100,
  maxApiResponseBytes: 256 * 1_024,
  maxArtifactBytes: 128 * 1_024 * 1_024,
  maxTotalArtifactBytes: 384 * 1_024 * 1_024,
};

const maximumStoredBrowserEvents = 10_000;

// A side recording is optional evidence, not an unbounded session archive. This keeps
// one 15-minute review from exhausting executor memory before durable persistence.
export interface LiveBrowserRawEvent {
  readonly kind: BrowserEvent["kind"];
  readonly level: BrowserEvent["level"];
  readonly message: string;
  readonly url?: string;
  readonly status?: number;
}

export interface LiveBrowserSideController {
  currentUrl(): string;
  title(signal: AbortSignal): Promise<string>;
  accessibilitySnapshot(signal: AbortSignal): Promise<string>;
  viewport(): { readonly width: number; readonly height: number };
  navigate(url: string, waitUntil: LiveNavigationWaitUntil, signal: AbortSignal): Promise<void>;
  count(locator: TestLocator, signal: AbortSignal): Promise<number>;
  click(locator: TestLocator, signal: AbortSignal): Promise<void>;
  fill(locator: TestLocator, value: string, signal: AbortSignal): Promise<void>;
  select(locator: TestLocator, option: LiveSelectOption, signal: AbortSignal): Promise<number>;
  press(locator: TestLocator, key: LivePressKey, signal: AbortSignal): Promise<void>;
  isVisible(locator: TestLocator, signal: AbortSignal): Promise<boolean>;
  textContent(locator: TestLocator, signal: AbortSignal): Promise<string>;
  apiRequest(
    request: ResolvedLiveApiRequest,
    maximumResponseBytes: number,
    signal: AbortSignal,
  ): Promise<LiveApiRawResponse>;
  screenshot(signal: AbortSignal): Promise<Uint8Array>;
  finishRecording(capture: boolean, maximumBytes: number): Promise<Uint8Array | undefined>;
  close(): Promise<void>;
}

export interface LiveBrowserRuntime {
  createSide(
    side: ReviewSide,
    origin: string,
    onEvent: (event: LiveBrowserRawEvent) => void,
  ): Promise<LiveBrowserSideController>;
  close(): Promise<void>;
}

export interface LiveBrowserSessionOptions {
  readonly origins: Readonly<Record<ReviewSide, string>>;
  readonly secrets?: Readonly<Record<string, string>>;
  readonly budgets?: Partial<LiveBrowserBudgets>;
  readonly runtime?: LiveBrowserRuntime;
  readonly signal?: AbortSignal;
  readonly now?: () => Date;
  readonly idFactory?: () => string;
}

export interface LiveBrowserObservation {
  readonly id: string;
  readonly side: ReviewSide;
  readonly path: string;
  readonly title: string;
  readonly snapshot: string;
  readonly snapshotTruncated: boolean;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly stateVersion: number;
  readonly observedAt: string;
}

export interface LiveCountResult {
  readonly count: number;
  readonly stateVersion: number;
}

export interface LiveActionResult {
  readonly side: ReviewSide;
  readonly stateVersion: number;
  readonly path: string;
}

export interface LiveAssertionRecord {
  readonly id: string;
  readonly name: string;
  readonly sequence: number;
  readonly side: ReviewSide;
  readonly stateVersion: number;
  readonly path: string;
  readonly kind: LiveAssertion["kind"] | "api_status" | "api_text" | "api_json";
  readonly locatorFingerprint: string;
  readonly sourceResponseId?: string | undefined;
  readonly passed: boolean;
  readonly expected: string;
  readonly actual: string;
  readonly createdAt: string;
}

export interface LiveApiRawResponse {
  readonly status: number;
  readonly contentType?: string | undefined;
  readonly body: Uint8Array;
  readonly bodyTruncated: boolean;
}

export interface LiveApiResponseRecord {
  readonly id: string;
  readonly name: string;
  readonly sequence: number;
  readonly side: ReviewSide;
  readonly stateVersion: number;
  readonly method: LiveApiRequest["method"];
  readonly path: string;
  readonly requestFingerprint: string;
  readonly status: number;
  readonly contentType?: string | undefined;
  readonly bodySha256: string;
  readonly bodyPreview: string;
  readonly bodyTruncated: boolean;
  readonly capturedByteSize: number;
  readonly createdAt: string;
}

export interface LiveCheckpointRecord {
  readonly artifactId?: string | undefined;
  readonly name: string;
  readonly side: ReviewSide;
  readonly stateVersion: number;
  readonly path: string;
  readonly captured: boolean;
  readonly digest?: string | undefined;
  readonly byteSize?: number | undefined;
  readonly mediaType?: "image/png" | undefined;
  readonly createdAt: string;
}

export interface LiveRecordingArtifactRecord {
  readonly artifactId?: string | undefined;
  readonly side: ReviewSide;
  readonly captured: boolean;
  readonly digest?: string | undefined;
  readonly byteSize?: number | undefined;
  readonly mediaType?: "video/webm" | undefined;
  readonly createdAt: string;
}

export interface LiveBrowserEvent extends BrowserEvent {
  readonly id: string;
  readonly sequence: number;
  readonly side: ReviewSide;
}

export interface LiveBrowserEventsResult {
  readonly events: readonly LiveBrowserEvent[];
  readonly cursor: string;
  readonly hasMore: boolean;
}

export type LiveToolName =
  | "api_assert"
  | "api_request"
  | "api_request_pair"
  | "browser_assert"
  | "browser_checkpoint"
  | "browser_checkpoint_pair"
  | "browser_click"
  | "browser_count"
  | "browser_events"
  | "browser_fill"
  | "browser_navigate"
  | "browser_observe"
  | "browser_press"
  | "browser_reset"
  | "browser_select"
  | "finish_review";

export interface LiveEvidenceEntry {
  readonly id: string;
  readonly sequence: number;
  readonly tool: LiveToolName;
  readonly side?: ReviewSide | undefined;
  readonly stateVersion?: number | undefined;
  readonly observationId?: string | undefined;
  readonly input: Readonly<Record<string, unknown>>;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly outcome: "success" | "error";
  readonly result: string;
  readonly errorCode?: LiveBrowserErrorCode | undefined;
}

export type LiveBrowserTerminalState = "active" | "cancelled" | "finished" | "timed_out";

export interface LiveBrowserStatus {
  readonly state: LiveBrowserTerminalState;
  readonly actionsUsed: number;
  readonly actionsRemaining: number;
  readonly checkpointsRemaining: number;
  readonly resetsRemaining: number;
  readonly expiresAt: string;
  readonly stateVersions: Readonly<Record<ReviewSide, number>>;
}

export interface LiveBrowserEvidence {
  readonly status: LiveBrowserStatus;
  readonly ledger: readonly LiveEvidenceEntry[];
  readonly observations: readonly Omit<LiveBrowserObservation, "snapshot">[];
  readonly assertions: readonly LiveAssertionRecord[];
  readonly matchedAssertionNames: readonly string[];
  readonly apiResponses: readonly LiveApiResponseRecord[];
  readonly checkpoints: readonly LiveCheckpointRecord[];
  readonly matchedCheckpointNames: readonly string[];
  readonly recordings: readonly LiveRecordingArtifactRecord[];
  readonly events: readonly LiveBrowserEvent[];
}

interface SideState {
  controller: LiveBrowserSideController;
  version: number;
  observation?: LiveBrowserObservation;
  secretTainted: boolean;
  recordingSecretTainted: boolean;
}

interface StoredArtifact {
  readonly metadata: {
    readonly artifactId: string;
    readonly byteSize: number;
    readonly digest: string;
    readonly mediaType: "image/png" | "video/webm";
  };
  readonly bytes: Uint8Array;
}

interface PendingCheckpoint {
  readonly name: string;
  readonly side: ReviewSide;
  readonly stateVersion: number;
  readonly path: string;
  readonly captured: boolean;
  readonly bytes?: Uint8Array;
  readonly digest?: string;
}

interface PendingApiResponse {
  readonly name: string;
  readonly side: ReviewSide;
  readonly stateVersion: number;
  readonly method: LiveApiRequest["method"];
  readonly path: string;
  readonly requestFingerprint: string;
  readonly status: number;
  readonly contentType?: string | undefined;
  readonly bodySha256: string;
  readonly bodyPreview: string;
  readonly bodyTruncated: boolean;
  readonly capturedByteSize: number;
  readonly assertionBodyText: string;
}

type PendingBrowserAssertion = Omit<LiveAssertionRecord, "id" | "sequence" | "createdAt">;

interface ToolContext {
  readonly signal: AbortSignal;
  readonly startedAt: string;
  readonly evidenceSequence: number;
}

const navigationInputSchema = z.strictObject({
  path: z
    .string()
    .regex(/^\/(?!\/).*/)
    .max(2_000),
  waitUntil: testNavigationWaitUntilSchema,
});
const fillInputSchema = z.strictObject({
  locator: testLocatorSchema,
  value: testInputValueSchema,
});
const selectInputSchema = z.strictObject({
  locator: testLocatorSchema,
  option: testSelectOptionSchema,
});
const pressInputSchema = z.strictObject({
  locator: testLocatorSchema,
  key: testPressKeySchema,
});
const evidenceNameSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(80);

function parseLiveInput<T>(schema: z.ZodType<T>, candidate: unknown, label: string): T {
  const parsed = schema.safeParse(candidate);
  if (!parsed.success) {
    throw new LiveBrowserError("INVALID_INPUT", `Invalid ${label} input.`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

function relativePath(url: string, expectedOrigin: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new LiveBrowserError("SAME_ORIGIN_REQUIRED", "Browser URL is invalid.", { cause: error });
  }
  if (parsed.origin !== expectedOrigin) {
    throw new LiveBrowserError(
      "SAME_ORIGIN_REQUIRED",
      "Browser navigation escaped the assigned application origin.",
    );
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function boundedUtf8(
  value: string,
  maximumBytes: number,
): { readonly value: string; readonly truncated: boolean } {
  const encoded = Buffer.from(value, "utf8");
  if (encoded.byteLength <= maximumBytes) return { value, truncated: false };
  const suffix = "\n[truncated]";
  const suffixBytes = Buffer.byteLength(suffix);
  if (maximumBytes <= suffixBytes) {
    return {
      value: Buffer.from(suffix, "utf8")
        .subarray(0, maximumBytes)
        .toString("utf8")
        .replace(/\uFFFD$/u, ""),
      truncated: true,
    };
  }
  const contentLimit = Math.max(0, maximumBytes - suffixBytes);
  return {
    value: `${encoded
      .subarray(0, contentLimit)
      .toString("utf8")
      .replace(/\uFFFD$/u, "")}${suffix}`,
    truncated: true,
  };
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function locatorFor(page: Page, locator: TestLocator): Locator {
  switch (locator.kind) {
    case "role":
      return page.getByRole(locator.role, { name: locator.name, exact: locator.exact });
    case "label":
      return page.getByLabel(locator.text, { exact: true });
    case "text":
      return page.getByText(locator.text, { exact: locator.exact });
    case "test_id":
      return page.getByTestId(locator.value);
  }
}

class PlaywrightSideController implements LiveBrowserSideController {
  readonly #context: BrowserContext;
  readonly #page: Page;
  readonly #origin: string;
  readonly #video: Video;
  readonly #recordingDirectory: string;
  #contextClosePromise?: Promise<void>;
  #recordingPromise: Promise<Uint8Array | undefined> | undefined;
  #recordingFinished = false;

  constructor(
    context: BrowserContext,
    page: Page,
    origin: string,
    video: Video,
    recordingDirectory: string,
  ) {
    this.#context = context;
    this.#page = page;
    this.#origin = origin;
    this.#video = video;
    this.#recordingDirectory = recordingDirectory;
  }

  currentUrl(): string {
    return this.#page.url();
  }

  async title(signal: AbortSignal): Promise<string> {
    return this.#run(signal, () => this.#page.title());
  }

  async accessibilitySnapshot(signal: AbortSignal): Promise<string> {
    return this.#run(signal, () => this.#page.locator("body").ariaSnapshot({ timeout: 5_000 }));
  }

  viewport(): { readonly width: number; readonly height: number } {
    return this.#page.viewportSize() ?? { width: 1_440, height: 900 };
  }

  async navigate(
    url: string,
    waitUntil: LiveNavigationWaitUntil,
    signal: AbortSignal,
  ): Promise<void> {
    await this.#run(signal, async () => {
      await this.#page.goto(url, { waitUntil });
      this.#assertSameOrigin();
    });
  }

  async count(locator: TestLocator, signal: AbortSignal): Promise<number> {
    return this.#run(signal, async () => {
      this.#assertSameOrigin();
      return locatorFor(this.#page, locator).count();
    });
  }

  async click(locator: TestLocator, signal: AbortSignal): Promise<void> {
    await this.#run(signal, async () => {
      await locatorFor(this.#page, locator).click();
      this.#assertSameOrigin();
    });
  }

  async fill(locator: TestLocator, value: string, signal: AbortSignal): Promise<void> {
    await this.#run(signal, async () => {
      await locatorFor(this.#page, locator).fill(value);
      this.#assertSameOrigin();
    });
  }

  async select(
    locator: TestLocator,
    option: LiveSelectOption,
    signal: AbortSignal,
  ): Promise<number> {
    return this.#run(signal, async () => {
      const selected = await locatorFor(this.#page, locator).selectOption(
        option.kind === "value"
          ? { value: option.value }
          : option.kind === "label"
            ? { label: option.label }
            : { index: option.index },
      );
      this.#assertSameOrigin();
      return selected.length;
    });
  }

  async press(locator: TestLocator, key: LivePressKey, signal: AbortSignal): Promise<void> {
    await this.#run(signal, async () => {
      await locatorFor(this.#page, locator).press(key);
      this.#assertSameOrigin();
    });
  }

  async isVisible(locator: TestLocator, signal: AbortSignal): Promise<boolean> {
    return this.#run(signal, async () => {
      this.#assertSameOrigin();
      return locatorFor(this.#page, locator).isVisible();
    });
  }

  async textContent(locator: TestLocator, signal: AbortSignal): Promise<string> {
    return this.#run(signal, async () => {
      this.#assertSameOrigin();
      return (await locatorFor(this.#page, locator).textContent()) ?? "";
    });
  }

  async apiRequest(
    request: ResolvedLiveApiRequest,
    maximumResponseBytes: number,
    signal: AbortSignal,
  ): Promise<LiveApiRawResponse> {
    return this.#run(signal, async () => {
      this.#assertSameOrigin();
      const target = new URL(request.path, `${this.#origin}/`);
      if (target.origin !== this.#origin) {
        throw new LiveBrowserError(
          "SAME_ORIGIN_REQUIRED",
          "API request escaped the assigned application origin.",
        );
      }
      const headers = new Headers(request.headers);
      const cookies = await this.#context.cookies(target.href);
      if (cookies.length > 0) {
        headers.set("Cookie", cookies.map(({ name, value }) => `${name}=${value}`).join("; "));
      }
      const response = await fetch(target, {
        method: request.method,
        headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        redirect: "manual",
        signal,
      });
      const chunks: Uint8Array[] = [];
      let capturedByteSize = 0;
      let bodyTruncated = false;
      const reader = response.body?.getReader();
      if (reader) {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          const remaining = maximumResponseBytes - capturedByteSize;
          if (remaining <= 0) {
            bodyTruncated = true;
            await reader.cancel();
            break;
          }
          if (next.value.byteLength > remaining) {
            chunks.push(next.value.subarray(0, remaining));
            capturedByteSize += remaining;
            bodyTruncated = true;
            await reader.cancel();
            break;
          }
          chunks.push(next.value);
          capturedByteSize += next.value.byteLength;
        }
      }
      return {
        status: response.status,
        ...(response.headers.get("content-type")
          ? { contentType: response.headers.get("content-type") ?? undefined }
          : {}),
        body: Uint8Array.from(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))),
        bodyTruncated,
      };
    });
  }

  async screenshot(signal: AbortSignal): Promise<Uint8Array> {
    return this.#run(signal, () =>
      this.#page.screenshot({ animations: "disabled", fullPage: false, type: "png" }),
    );
  }

  async finishRecording(capture: boolean, maximumBytes: number): Promise<Uint8Array | undefined> {
    if (this.#recordingFinished) return undefined;
    const recordingPromise = (this.#recordingPromise ??= this.#finishRecording(
      capture,
      maximumBytes,
    ));
    try {
      const bytes = await recordingPromise;
      return bytes ? Uint8Array.from(bytes) : undefined;
    } finally {
      if (this.#recordingPromise === recordingPromise) {
        this.#recordingFinished = true;
        this.#recordingPromise = undefined;
      }
    }
  }

  async close(): Promise<void> {
    try {
      await this.finishRecording(false, maximumLiveBrowserRecordingArtifactBytes);
    } catch {
      // Cleanup remains best-effort after a prior capture failure.
    }
  }

  #assertSameOrigin(): void {
    relativePath(this.#page.url(), this.#origin);
  }

  async #run<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    const closeOnAbort = (): void => {
      // Closing the context interrupts Playwright without deciding whether its video is safe.
      // Seal makes that decision after the in-flight tool has left the exclusive section.
      void this.#closeContext().catch(() => undefined);
    };
    signal.addEventListener("abort", closeOnAbort, { once: true });
    try {
      return await operation();
    } finally {
      signal.removeEventListener("abort", closeOnAbort);
    }
  }

  async #closeContext(): Promise<void> {
    if (!this.#contextClosePromise) {
      this.#contextClosePromise = this.#context.close();
    }
    await this.#contextClosePromise;
  }

  async #finishRecording(capture: boolean, maximumBytes: number): Promise<Uint8Array | undefined> {
    try {
      await this.#closeContext();
      if (!capture) {
        await this.#video.delete().catch(() => undefined);
        return undefined;
      }
      const recordingPath = await this.#video.path();
      const metadata = await stat(recordingPath);
      if (metadata.size <= 0 || metadata.size > maximumBytes) {
        throw new LiveBrowserError(
          "ARTIFACT_LIMIT",
          "Browser recording exceeds the per-side artifact limit.",
        );
      }
      const bytes = await readFile(recordingPath);
      if (bytes.byteLength !== metadata.size || bytes.byteLength > maximumBytes) {
        throw new LiveBrowserError(
          "ARTIFACT_LIMIT",
          "Browser recording changed while enforcing the per-side artifact limit.",
        );
      }
      return Uint8Array.from(bytes);
    } finally {
      await rm(this.#recordingDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

class PlaywrightLiveBrowserRuntime implements LiveBrowserRuntime {
  readonly #browser: Browser;
  readonly #controllers = new Set<LiveBrowserSideController>();
  #closed = false;

  private constructor(browser: Browser) {
    this.#browser = browser;
  }

  static async launch(): Promise<PlaywrightLiveBrowserRuntime> {
    return new PlaywrightLiveBrowserRuntime(await chromium.launch({ headless: true }));
  }

  async createSide(
    _side: ReviewSide,
    origin: string,
    onEvent: (event: LiveBrowserRawEvent) => void,
  ): Promise<LiveBrowserSideController> {
    if (this.#closed) throw new LiveBrowserError("SESSION_SEALED", "Browser runtime is closed.");
    const recordingDirectory = await mkdtemp(join(tmpdir(), "trialrun-live-browser-"));
    let context: BrowserContext | undefined;
    let controller: PlaywrightSideController | undefined;
    try {
      context = await this.#browser.newContext({
        viewport: { width: 1_440, height: 900 },
        locale: "en-US",
        timezoneId: "UTC",
        colorScheme: "dark",
        reducedMotion: "reduce",
        serviceWorkers: "block",
        recordVideo: { dir: recordingDirectory, size: { width: 720, height: 450 } },
      });
      const page = await context.newPage();
      const video = page.video();
      if (!video) throw new Error("Playwright did not create the requested browser recording.");
      controller = new PlaywrightSideController(context, page, origin, video, recordingDirectory);
      page.setDefaultTimeout(10_000);
      page.setDefaultNavigationTimeout(20_000);
      page.on("console", (message) => {
        const type = message.type();
        onEvent({
          kind: "console",
          level: type === "error" ? "error" : type === "warning" ? "warning" : "info",
          message: message.text(),
        });
      });
      page.on("pageerror", (error) => {
        onEvent({ kind: "page_error", level: "error", message: error.message });
      });
      page.on("response", (response) => {
        if (response.status() < 400) return;
        onEvent({
          kind: "http_error",
          level: "error",
          message: `${response.request().method()} returned HTTP ${response.status()}`,
          url: response.url(),
          status: response.status(),
        });
      });
      page.on("requestfailed", (request) => {
        onEvent({
          kind: "request_failed",
          level: "error",
          message: request.failure()?.errorText ?? "Request failed",
          url: request.url(),
        });
      });
      this.#controllers.add(controller);
      const initializationController = new AbortController();
      const timer = setTimeout(
        () => initializationController.abort(new Error("Initial browser navigation timed out.")),
        20_000,
      );
      try {
        await controller.navigate(
          `${origin}/`,
          "domcontentloaded",
          initializationController.signal,
        );
      } finally {
        clearTimeout(timer);
      }
      return controller;
    } catch (error) {
      if (controller) {
        this.#controllers.delete(controller);
        await controller.close();
      } else {
        await context?.close().catch(() => undefined);
        await rm(recordingDirectory, { recursive: true, force: true }).catch(() => undefined);
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    const controllers = [...this.#controllers];
    this.#controllers.clear();
    await Promise.allSettled(controllers.map((controller) => controller.close()));
    await this.#browser.close();
  }
}

export class LiveBrowserSession {
  readonly #origins: Readonly<Record<ReviewSide, string>>;
  readonly #secrets: Readonly<Record<string, string>>;
  readonly #redactionValues: readonly string[];
  readonly #budgets: LiveBrowserBudgets;
  readonly #runtime: LiveBrowserRuntime;
  readonly #now: () => Date;
  readonly #idFactory: () => string;
  #expiresAtMs?: number;
  readonly #sessionAbort = new AbortController();
  readonly #sides = new Map<ReviewSide, SideState>();
  readonly #usedIds = new Set<string>();
  readonly #ledger: LiveEvidenceEntry[] = [];
  readonly #observations: Array<Omit<LiveBrowserObservation, "snapshot">> = [];
  readonly #assertions: LiveAssertionRecord[] = [];
  readonly #apiResponses: LiveApiResponseRecord[] = [];
  readonly #apiResponseBodies = new Map<string, string>();
  readonly #checkpoints: LiveCheckpointRecord[] = [];
  readonly #recordings: LiveRecordingArtifactRecord[] = [];
  readonly #events: LiveBrowserEvent[] = [];
  readonly #eventCursors = new Map<string, { readonly side: ReviewSide; readonly index: number }>();
  readonly #artifacts = new Map<string, StoredArtifact>();
  #actionsUsed = 0;
  #resetsUsed = 0;
  #evidenceSequence = 0;
  #assertionSequence = 0;
  #apiResponseSequence = 0;
  #eventSequence = 0;
  #lastTimestampMs = 0;
  #totalArtifactBytes = 0;
  #terminalState: LiveBrowserTerminalState = "active";
  #artifactsSealed = false;
  #exclusiveTail: Promise<void> = Promise.resolve();
  #sealPromise?: Promise<LiveBrowserEvidence>;

  private constructor(
    options: LiveBrowserSessionOptions,
    origins: Readonly<Record<ReviewSide, string>>,
    budgets: LiveBrowserBudgets,
    runtime: LiveBrowserRuntime,
  ) {
    this.#origins = origins;
    this.#secrets = Object.freeze({ ...(options.secrets ?? {}) });
    this.#redactionValues = Object.values(this.#secrets).filter((value) => value.length > 0);
    this.#budgets = budgets;
    this.#runtime = runtime;
    this.#now = options.now ?? (() => new Date());
    this.#idFactory = options.idFactory ?? randomUUID;
    this.#lastTimestampMs = this.#now().getTime() - 1;
  }

  static async create(options: LiveBrowserSessionOptions): Promise<LiveBrowserSession> {
    const origins = {
      base: LiveBrowserSession.#validatedOrigin(options.origins.base),
      head: LiveBrowserSession.#validatedOrigin(options.origins.head),
    };
    const budgets = LiveBrowserSession.#validatedBudgets(options.budgets);
    const runtime = options.runtime ?? (await PlaywrightLiveBrowserRuntime.launch());
    const session = new LiveBrowserSession(options, origins, budgets, runtime);
    try {
      const [base, head] = await Promise.all([
        runtime.createSide("base", origins.base, (event) =>
          session.#recordBrowserEvent("base", event),
        ),
        runtime.createSide("head", origins.head, (event) =>
          session.#recordBrowserEvent("head", event),
        ),
      ]);
      session.#sides.set("base", {
        controller: base,
        version: 0,
        secretTainted: false,
        recordingSecretTainted: false,
      });
      session.#sides.set("head", {
        controller: head,
        version: 0,
        secretTainted: false,
        recordingSecretTainted: false,
      });
    } catch (error) {
      await runtime.close();
      throw error;
    }
    if (options.signal) {
      const cancel = (): void => {
        void session.cancel().catch(() => undefined);
      };
      if (options.signal.aborted) cancel();
      else options.signal.addEventListener("abort", cancel, { once: true });
    }
    return session;
  }

  status(): LiveBrowserStatus {
    return {
      state: this.#terminalState,
      actionsUsed: this.#actionsUsed,
      actionsRemaining: Math.max(0, this.#budgets.maxActions - this.#actionsUsed),
      checkpointsRemaining: Math.max(0, this.#budgets.maxCheckpoints - this.#checkpoints.length),
      resetsRemaining: Math.max(0, this.#budgets.maxResets - this.#resetsUsed),
      expiresAt: new Date(
        this.#expiresAtMs ?? this.#now().getTime() + this.#budgets.maxDurationMs,
      ).toISOString(),
      stateVersions: {
        base: this.#sides.get("base")?.version ?? 0,
        head: this.#sides.get("head")?.version ?? 0,
      },
    };
  }

  evidence(): LiveBrowserEvidence {
    const baseAssertionNames = new Set(
      this.#assertions.filter((assertion) => assertion.side === "base").map(({ name }) => name),
    );
    const matchedAssertionNames = [
      ...new Set(
        this.#assertions
          .filter(
            (assertion) => assertion.side === "head" && baseAssertionNames.has(assertion.name),
          )
          .map(({ name }) => name),
      ),
    ].sort();
    const baseNames = new Set(
      this.#checkpoints
        .filter((checkpoint) => checkpoint.side === "base" && checkpoint.captured)
        .map(({ name }) => name),
    );
    const matchedCheckpointNames = [
      ...new Set(
        this.#checkpoints
          .filter(
            (checkpoint) =>
              checkpoint.side === "head" && checkpoint.captured && baseNames.has(checkpoint.name),
          )
          .map(({ name }) => name),
      ),
    ].sort();
    return {
      status: this.status(),
      ledger: this.#ledger.map((entry) => ({ ...entry, input: { ...entry.input } })),
      observations: this.#observations.map((observation) => ({ ...observation })),
      assertions: this.#assertions.map((assertion) => ({ ...assertion })),
      matchedAssertionNames,
      apiResponses: this.#apiResponses.map((response) => ({ ...response })),
      checkpoints: this.#checkpoints.map((checkpoint) => ({ ...checkpoint })),
      matchedCheckpointNames,
      recordings: this.#recordings.map((recording) => ({ ...recording })),
      events: this.#events.map((event) => ({ ...event })),
    };
  }

  async observe(input: {
    readonly side: ReviewSide;
    readonly signal?: AbortSignal;
  }): Promise<LiveBrowserObservation> {
    return this.#tool("browser_observe", input.side, {}, input.signal, async ({ signal }) => {
      const state = this.#side(input.side);
      this.#safeCurrentPath(input.side, state.controller);
      const [title, rawSnapshot] = await Promise.all([
        state.controller.title(signal),
        state.controller.accessibilitySnapshot(signal),
      ]);
      const path = this.#safeCurrentPath(input.side, state.controller);
      const redactedTitle = this.#redact(title);
      const redactedSnapshot = this.#redact(rawSnapshot);
      if (redactedTitle !== title || redactedSnapshot !== rawSnapshot) {
        state.secretTainted = true;
        state.recordingSecretTainted = true;
      }
      const snapshot = boundedUtf8(redactedSnapshot, this.#budgets.maxSnapshotBytes);
      const observation: LiveBrowserObservation = {
        id: this.#opaqueId("obs"),
        side: input.side,
        path,
        title: boundedUtf8(redactedTitle, 512).value,
        snapshot: snapshot.value,
        snapshotTruncated: snapshot.truncated,
        viewport: state.controller.viewport(),
        stateVersion: state.version,
        observedAt: this.#timestamp(),
      };
      state.observation = observation;
      this.#observations.push({
        id: observation.id,
        side: observation.side,
        path: observation.path,
        title: observation.title,
        snapshotTruncated: observation.snapshotTruncated,
        viewport: observation.viewport,
        stateVersion: observation.stateVersion,
        observedAt: observation.observedAt,
      });
      return {
        value: observation,
        result: `observation ${observation.id}; snapshot sha256=${sha256(snapshot.value)}; ${Buffer.byteLength(snapshot.value)} bytes`,
        observationId: observation.id,
        stateVersion: state.version,
      };
    });
  }

  async navigate(input: {
    readonly side: ReviewSide;
    readonly path: string;
    readonly waitUntil?: LiveNavigationWaitUntil;
    readonly signal?: AbortSignal;
  }): Promise<LiveActionResult> {
    const navigation = parseLiveInput(
      navigationInputSchema,
      { path: input.path, waitUntil: input.waitUntil ?? "domcontentloaded" },
      "navigation",
    );
    return this.#tool(
      "browser_navigate",
      input.side,
      { path: this.#redact(navigation.path), waitUntil: navigation.waitUntil },
      input.signal,
      async ({ signal }) => {
        this.#rejectSecretBearingPath(navigation.path);
        const state = this.#invalidate(input.side);
        const target = new URL(navigation.path, `${this.#origins[input.side]}/`);
        if (target.origin !== this.#origins[input.side]) {
          throw new LiveBrowserError(
            "SAME_ORIGIN_REQUIRED",
            "Navigation must remain on the assigned origin.",
          );
        }
        await state.controller.navigate(target.href, navigation.waitUntil, signal);
        const path = this.#safeCurrentPath(input.side, state.controller);
        return {
          value: { side: input.side, stateVersion: state.version, path },
          result: `navigated to ${path}`,
          stateVersion: state.version,
        };
      },
    );
  }

  async count(input: {
    readonly side: ReviewSide;
    readonly observationId: string;
    readonly locator: TestLocator;
    readonly signal?: AbortSignal;
  }): Promise<LiveCountResult> {
    const locator = parseLiveInput(testLocatorSchema, input.locator, "locator");
    return this.#tool(
      "browser_count",
      input.side,
      { observationId: input.observationId, locator: this.#locatorSummary(locator) },
      input.signal,
      async ({ signal }) => {
        const state = this.#requireObservation(input.side, input.observationId);
        const count = await state.controller.count(locator, signal);
        return {
          value: { count, stateVersion: state.version },
          result: `${count} semantic matches`,
          observationId: input.observationId,
          stateVersion: state.version,
        };
      },
    );
  }

  async click(input: {
    readonly side: ReviewSide;
    readonly observationId: string;
    readonly locator: TestLocator;
    readonly signal?: AbortSignal;
  }): Promise<LiveActionResult> {
    const locator = parseLiveInput(testLocatorSchema, input.locator, "locator");
    return this.#interaction(
      "browser_click",
      input.side,
      input.observationId,
      locator,
      { observationId: input.observationId, locator: this.#locatorSummary(locator) },
      input.signal,
      (controller, signal) => controller.click(locator, signal),
    );
  }

  async fill(input: {
    readonly side: ReviewSide;
    readonly observationId: string;
    readonly locator: TestLocator;
    readonly value: LiveFillValue;
    readonly signal?: AbortSignal;
  }): Promise<LiveActionResult> {
    const fill = parseLiveInput(
      fillInputSchema,
      { locator: input.locator, value: input.value },
      "fill",
    );
    const result = await this.#interaction(
      "browser_fill",
      input.side,
      input.observationId,
      fill.locator,
      {
        observationId: input.observationId,
        locator: this.#locatorSummary(fill.locator),
        value:
          fill.value.kind === "secret"
            ? { kind: "secret", name: fill.value.name }
            : { kind: "literal", length: fill.value.value.length },
      },
      input.signal,
      async (controller, signal) => {
        const suppliedValue =
          fill.value.kind === "literal" ? fill.value.value : this.#secrets[fill.value.name];
        if (suppliedValue === undefined) {
          throw new LiveBrowserError(
            "SECRET_NOT_APPROVED",
            "Requested secret name is not approved.",
          );
        }
        if (fill.value.kind === "secret") {
          const state = this.#side(input.side);
          state.secretTainted = true;
          state.recordingSecretTainted = true;
        }
        await controller.fill(fill.locator, suppliedValue, signal);
      },
    );
    return result;
  }

  async select(input: {
    readonly side: ReviewSide;
    readonly observationId: string;
    readonly locator: TestLocator;
    readonly option: LiveSelectOption;
    readonly signal?: AbortSignal;
  }): Promise<LiveActionResult> {
    const select = parseLiveInput(
      selectInputSchema,
      { locator: input.locator, option: input.option },
      "select",
    );
    return this.#interaction(
      "browser_select",
      input.side,
      input.observationId,
      select.locator,
      {
        observationId: input.observationId,
        locator: this.#locatorSummary(select.locator),
        option: select.option,
      },
      input.signal,
      async (controller, signal) => {
        await controller.select(select.locator, select.option, signal);
      },
    );
  }

  async press(input: {
    readonly side: ReviewSide;
    readonly observationId: string;
    readonly locator: TestLocator;
    readonly key: LivePressKey;
    readonly signal?: AbortSignal;
  }): Promise<LiveActionResult> {
    const press = parseLiveInput(
      pressInputSchema,
      { locator: input.locator, key: input.key },
      "press",
    );
    return this.#interaction(
      "browser_press",
      input.side,
      input.observationId,
      press.locator,
      {
        observationId: input.observationId,
        locator: this.#locatorSummary(press.locator),
        key: press.key,
      },
      input.signal,
      (controller, signal) => controller.press(press.locator, press.key, signal),
    );
  }

  async assert(input: {
    readonly side: ReviewSide;
    readonly name: string;
    readonly assertion: LiveAssertion;
    readonly signal?: AbortSignal;
  }): Promise<LiveAssertionRecord> {
    const expected = parseLiveInput(testAssertionSchema, input.assertion, "assertion");
    const name = parseLiveInput(evidenceNameSchema, input.name, "evidence name");
    return this.#tool(
      "browser_assert",
      input.side,
      { name, assertion: this.#assertionSummary(expected) },
      input.signal,
      async ({ signal }) => {
        const assertion = this.#commitBrowserAssertion(
          await this.#prepareBrowserAssertion(input.side, name, expected, signal),
        );
        return {
          value: assertion,
          result: `assertion ${assertion.id} ${assertion.passed ? "passed" : "failed"}`,
          stateVersion: assertion.stateVersion,
        };
      },
    );
  }

  async apiRequest(input: {
    readonly side: ReviewSide;
    readonly name: string;
    readonly request: LiveApiRequest;
    readonly signal?: AbortSignal;
  }): Promise<LiveApiResponseRecord> {
    const name = parseLiveInput(evidenceNameSchema, input.name, "evidence name");
    const request = this.#parseApiRequest(input.request);
    const resolved = this.#resolveApiRequest(request);
    this.#rejectSecretBearingPath(request.path);
    return this.#tool(
      "api_request",
      input.side,
      { name, request: this.#apiRequestSummary(resolved) },
      input.signal,
      async ({ signal }) => {
        this.#requireApiResponseName(input.side, name);
        const pending = await this.#prepareApiResponse(input.side, name, request, resolved, signal);
        const response = this.#commitApiResponse(pending);
        return {
          value: response,
          result: `API response ${response.id}: HTTP ${response.status}; sha256=${response.bodySha256}; ${response.capturedByteSize} redacted bytes${response.bodyTruncated ? "; truncated" : ""}`,
          stateVersion: response.stateVersion,
        };
      },
    );
  }

  async apiRequestPair(input: {
    readonly name: string;
    readonly request: LiveApiRequest;
    readonly signal?: AbortSignal;
  }): Promise<{ readonly base: LiveApiResponseRecord; readonly head: LiveApiResponseRecord }> {
    const name = parseLiveInput(evidenceNameSchema, input.name, "evidence name");
    const request = this.#parseApiRequest(input.request);
    const resolved = this.#resolveApiRequest(request);
    this.#rejectSecretBearingPath(request.path);
    return this.#tool(
      "api_request_pair",
      undefined,
      { name, request: this.#apiRequestSummary(resolved) },
      input.signal,
      async ({ signal }) => {
        this.#requireApiResponseName("base", name);
        this.#requireApiResponseName("head", name);
        const [basePending, headPending] = await Promise.all([
          this.#prepareApiResponse("base", name, request, resolved, signal),
          this.#prepareApiResponse("head", name, request, resolved, signal),
        ]);
        const base = this.#commitApiResponse(basePending);
        const head = this.#commitApiResponse(headPending);
        return {
          value: { base, head },
          result: `paired API responses ${base.id} and ${head.id}: HTTP ${base.status}/${head.status}`,
        };
      },
    );
  }

  async apiAssert(input: {
    readonly side: ReviewSide;
    readonly name: string;
    readonly responseId: string;
    readonly assertion: LiveApiAssertion;
    readonly signal?: AbortSignal;
  }): Promise<LiveAssertionRecord> {
    const name = parseLiveInput(evidenceNameSchema, input.name, "evidence name");
    const parsed = liveApiAssertionSchema.safeParse(input.assertion);
    if (!parsed.success) {
      throw new LiveBrowserError("INVALID_INPUT", "Live API assertion is invalid.", {
        cause: parsed.error,
      });
    }
    return this.#tool(
      "api_assert",
      input.side,
      {
        name,
        responseId: input.responseId,
        assertion: this.#apiAssertionSummary(parsed.data),
      },
      input.signal,
      () => {
        if (
          this.#assertions.some(
            (assertion) => assertion.side === input.side && assertion.name === name,
          )
        ) {
          throw new LiveBrowserError(
            "INVALID_INPUT",
            `Assertion name ${name} is already recorded for ${input.side}.`,
          );
        }
        const response = this.#apiResponses.find(
          (candidate) => candidate.id === input.responseId && candidate.side === input.side,
        );
        const responseBody = response ? this.#apiResponseBodies.get(response.id) : undefined;
        if (!response || responseBody === undefined) {
          throw new LiveBrowserError(
            "INVALID_INPUT",
            "API response ID is missing or belongs to the other review side.",
          );
        }
        let evaluation;
        try {
          evaluation = evaluateLiveApiAssertion(
            {
              status: response.status,
              bodyText: responseBody,
              bodyTruncated: response.bodyTruncated,
              ...(response.contentType === undefined ? {} : { contentType: response.contentType }),
            },
            parsed.data,
          );
        } catch (error) {
          throw this.#normalizeApiError(error);
        }
        const kind =
          parsed.data.kind === "status"
            ? "api_status"
            : parsed.data.kind === "body_includes"
              ? "api_text"
              : "api_json";
        const assertion: LiveAssertionRecord = {
          id: this.#opaqueId("assert"),
          name,
          sequence: ++this.#assertionSequence,
          side: input.side,
          stateVersion: response.stateVersion,
          path: response.path,
          kind,
          locatorFingerprint: sha256(
            JSON.stringify({
              requestFingerprint: response.requestFingerprint,
              assertion: evaluation.fingerprintInput,
            }),
          ),
          sourceResponseId: response.id,
          passed: evaluation.passed,
          expected: boundedUtf8(this.#redact(evaluation.expected), 1_000).value,
          actual: boundedUtf8(this.#redact(evaluation.actual), 2_000).value,
          createdAt: this.#timestamp(),
        };
        this.#assertions.push(assertion);
        return Promise.resolve({
          value: assertion,
          result: `API assertion ${assertion.id} ${assertion.passed ? "passed" : "failed"}`,
          stateVersion: response.stateVersion,
        });
      },
    );
  }

  async checkpoint(input: {
    readonly side: ReviewSide;
    readonly name: string;
    readonly signal?: AbortSignal;
  }): Promise<LiveCheckpointRecord> {
    const name = parseLiveInput(evidenceNameSchema, input.name, "evidence name");
    return this.#tool(
      "browser_checkpoint",
      input.side,
      { name },
      input.signal,
      async ({ signal }) => {
        this.#requireCheckpointCapacity([{ side: input.side, name }]);
        const pending = await this.#prepareCheckpoint(input.side, name, signal, 0);
        const checkpoint = this.#commitCheckpoint(pending);
        return {
          value: checkpoint,
          result: checkpoint.captured
            ? `checkpoint ${name} captured as ${checkpoint.artifactId}`
            : `checkpoint ${name} withheld by secret-safe policy`,
          stateVersion: pending.stateVersion,
        };
      },
    );
  }

  async checkpointPair(input: {
    readonly name: string;
    readonly signal?: AbortSignal;
  }): Promise<{ readonly base: LiveCheckpointRecord; readonly head: LiveCheckpointRecord }> {
    const name = parseLiveInput(evidenceNameSchema, input.name, "evidence name");
    return this.#tool(
      "browser_checkpoint_pair",
      undefined,
      { name },
      input.signal,
      async ({ signal }) => {
        this.#requireCheckpointCapacity([
          { side: "base", name },
          { side: "head", name },
        ]);
        const baseState = this.#side("base");
        const headState = this.#side("head");
        const basePath = this.#safeCurrentPath("base", baseState.controller);
        const headPath = this.#safeCurrentPath("head", headState.controller);
        if (basePath !== headPath) {
          throw new LiveBrowserError(
            "INVALID_INPUT",
            "Matched checkpoints must be captured at the same application path.",
          );
        }
        if (baseState.secretTainted || headState.secretTainted) {
          throw new LiveBrowserError(
            "INVALID_INPUT",
            "Matched screenshots are unavailable after a named secret was used on either side.",
          );
        }

        const basePending = await this.#prepareCheckpoint("base", name, signal, 0);
        const headPending = await this.#prepareCheckpoint(
          "head",
          name,
          signal,
          basePending.bytes?.byteLength ?? 0,
        );
        const base = this.#commitCheckpoint(basePending);
        const head = this.#commitCheckpoint(headPending);
        return {
          value: { base, head },
          result: `checkpoint pair ${name} captured as ${base.artifactId} and ${head.artifactId}`,
        };
      },
    );
  }

  async events(input: {
    readonly side: ReviewSide;
    readonly cursor?: string;
    readonly signal?: AbortSignal;
  }): Promise<LiveBrowserEventsResult> {
    return this.#tool(
      "browser_events",
      input.side,
      { ...(input.cursor ? { cursor: input.cursor } : {}) },
      input.signal,
      () => {
        let startingIndex = 0;
        if (input.cursor) {
          const cursor = this.#eventCursors.get(input.cursor);
          if (!cursor || cursor.side !== input.side) {
            throw new LiveBrowserError("INVALID_CURSOR", "Event cursor is invalid for this side.");
          }
          startingIndex = cursor.index;
        }
        const sideEvents = this.#events.filter((event) => event.side === input.side);
        const events = sideEvents.slice(
          startingIndex,
          startingIndex + this.#budgets.maxEventsPerRead,
        );
        const nextIndex = startingIndex + events.length;
        const cursor = this.#opaqueId("cursor");
        this.#eventCursors.set(cursor, { side: input.side, index: nextIndex });
        return Promise.resolve({
          value: { events, cursor, hasMore: nextIndex < sideEvents.length },
          result: `${events.length} events returned`,
          stateVersion: this.#side(input.side).version,
        });
      },
    );
  }

  async reset(input: {
    readonly side: ReviewSide;
    readonly signal?: AbortSignal;
  }): Promise<LiveActionResult> {
    return this.#tool("browser_reset", input.side, {}, input.signal, async ({ signal }) => {
      if (this.#resetsUsed >= this.#budgets.maxResets) {
        throw new LiveBrowserError(
          "ACTION_BUDGET_EXHAUSTED",
          "Session browser-reset budget is exhausted.",
        );
      }
      this.#resetsUsed += 1;
      signal.throwIfAborted();
      const previous = this.#invalidate(input.side);
      await previous.controller.close();
      signal.throwIfAborted();
      const controller = await this.#runtime.createSide(
        input.side,
        this.#origins[input.side],
        (event) => this.#recordBrowserEvent(input.side, event),
      );
      previous.controller = controller;
      previous.secretTainted = false;
      const path = this.#safeCurrentPath(input.side, controller);
      return {
        value: { side: input.side, stateVersion: previous.version, path },
        result: `${input.side} context reset`,
        stateVersion: previous.version,
      };
    });
  }

  async seal(
    state: Exclude<LiveBrowserTerminalState, "active"> = "finished",
  ): Promise<LiveBrowserEvidence> {
    if (this.#sealPromise) return this.#sealPromise;
    const terminalState = this.#terminalState === "active" ? state : this.#terminalState;
    this.#terminalState = terminalState;
    this.#sessionAbort.abort(
      new LiveBrowserError(
        terminalState === "cancelled" ? "CANCELLED" : "SESSION_SEALED",
        "Session sealed.",
      ),
    );
    const sealPromise = this.#exclusive(async () => {
      const startedAt = this.#timestamp();
      const evidenceSequence = ++this.#evidenceSequence;
      let outcome: LiveEvidenceEntry["outcome"] = "success";
      let result = `session sealed as ${terminalState}`;
      for (const side of ["base", "head"] as const) {
        const finalized = await this.#finalizeRecording(side);
        this.#recordings.push(finalized.recording);
        if (finalized.error) {
          outcome = "error";
          result = `${result}; ${side} recording unavailable: ${finalized.error}`;
        }
      }
      try {
        await this.#runtime.close();
      } catch (error) {
        outcome = "error";
        result = `${result}; browser cleanup failed: ${this.#redact(errorMessage(error))}`;
      }
      this.#ledger.push({
        id: this.#opaqueId("evidence"),
        sequence: evidenceSequence,
        tool: "finish_review",
        input: { state: terminalState },
        startedAt,
        completedAt: this.#timestamp(),
        outcome,
        result: boundedUtf8(result, 2_000).value,
      });
      this.#artifactsSealed = true;
      return this.evidence();
    });
    this.#sealPromise = sealPromise;
    return sealPromise;
  }

  async cancel(): Promise<LiveBrowserEvidence> {
    return this.seal("cancelled");
  }

  artifact(artifactId: string): Uint8Array {
    if (!this.#artifactsSealed) {
      throw new LiveBrowserError(
        "SESSION_SEALED",
        "Artifacts are available only after evidence is sealed.",
      );
    }
    const artifact = this.#artifacts.get(artifactId);
    if (!artifact)
      throw new LiveBrowserError("INVALID_INPUT", "Artifact ID is not in the sealed manifest.");
    return Uint8Array.from(artifact.bytes);
  }

  async #finalizeRecording(side: ReviewSide): Promise<{
    readonly recording: LiveRecordingArtifactRecord;
    readonly error?: string;
  }> {
    const state = this.#side(side);
    const withheld = (): LiveRecordingArtifactRecord => ({
      side,
      captured: false,
      createdAt: this.#timestamp(),
    });
    if (state.recordingSecretTainted) {
      try {
        await state.controller.finishRecording(false, maximumLiveBrowserRecordingArtifactBytes);
        return { recording: withheld() };
      } catch (error) {
        return {
          recording: withheld(),
          error: boundedUtf8(this.#redact(errorMessage(error)), 500).value,
        };
      }
    }

    try {
      const bytes = await state.controller.finishRecording(
        true,
        maximumLiveBrowserRecordingArtifactBytes,
      );
      if (
        !bytes ||
        bytes.byteLength === 0 ||
        bytes.byteLength > maximumLiveBrowserRecordingArtifactBytes
      ) {
        throw new LiveBrowserError(
          "ARTIFACT_LIMIT",
          "Browser recording is empty or exceeds the per-side artifact limit.",
        );
      }
      if (this.#totalArtifactBytes + bytes.byteLength > this.#budgets.maxTotalArtifactBytes) {
        throw new LiveBrowserError(
          "ARTIFACT_LIMIT",
          "Browser recording exceeds the review artifact limit.",
        );
      }
      const digest = sha256(bytes);
      const artifactId = this.#opaqueDigestId("artifact", `${side}\0recording\0${digest}`);
      const metadata = {
        artifactId,
        digest,
        byteSize: bytes.byteLength,
        mediaType: "video/webm" as const,
      };
      this.#artifacts.set(artifactId, { metadata, bytes: Uint8Array.from(bytes) });
      this.#totalArtifactBytes += bytes.byteLength;
      return {
        recording: {
          ...metadata,
          side,
          captured: true,
          createdAt: this.#timestamp(),
        },
      };
    } catch (error) {
      return {
        recording: withheld(),
        error: boundedUtf8(this.#redact(errorMessage(error)), 500).value,
      };
    }
  }

  #parseApiRequest(request: LiveApiRequest): LiveApiRequest {
    const parsed = liveApiRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new LiveBrowserError("INVALID_INPUT", "Live API request is invalid.", {
        cause: parsed.error,
      });
    }
    return parsed.data;
  }

  #resolveApiRequest(request: LiveApiRequest): ResolvedLiveApiRequest {
    try {
      return resolveLiveApiRequest(request, this.#secrets);
    } catch (error) {
      throw this.#normalizeApiError(error);
    }
  }

  #normalizeApiError(error: unknown): LiveBrowserError {
    if (error instanceof LiveBrowserError) return error;
    if (error instanceof LiveApiContractError) {
      return new LiveBrowserError(error.code, error.message, { cause: error });
    }
    return new LiveBrowserError(
      "INVALID_INPUT",
      "Live API evidence could not be evaluated safely.",
      { cause: error },
    );
  }

  #apiRequestSummary(request: ResolvedLiveApiRequest): Readonly<Record<string, unknown>> {
    return {
      method: request.evidenceSummary.method,
      path: this.#redact(request.evidenceSummary.path),
      headerNames: request.evidenceSummary.headerNames,
      ...(request.evidenceSummary.body === undefined ? {} : { body: request.evidenceSummary.body }),
    };
  }

  #apiAssertionSummary(assertion: LiveApiAssertion): Readonly<Record<string, unknown>> {
    if (assertion.kind === "status") return { kind: assertion.kind, equals: assertion.equals };
    if (assertion.kind === "body_includes") {
      return { kind: assertion.kind, includes: this.#redact(assertion.includes) };
    }
    return {
      kind: assertion.kind,
      path: assertion.path,
      equals:
        typeof assertion.equals === "string" ? this.#redact(assertion.equals) : assertion.equals,
    };
  }

  #requireApiResponseName(side: ReviewSide, name: string): void {
    if (this.#apiResponses.some((response) => response.side === side && response.name === name)) {
      throw new LiveBrowserError(
        "INVALID_INPUT",
        `API response name ${name} is already recorded for ${side}.`,
      );
    }
  }

  async #prepareApiResponse(
    side: ReviewSide,
    name: string,
    request: LiveApiRequest,
    resolved: ResolvedLiveApiRequest,
    signal: AbortSignal,
  ): Promise<PendingApiResponse> {
    const state = this.#invalidate(side);
    if (resolved.secretNames.length > 0) {
      state.secretTainted = true;
      state.recordingSecretTainted = true;
    }
    let raw: LiveApiRawResponse;
    try {
      raw = await state.controller.apiRequest(resolved, this.#budgets.maxApiResponseBytes, signal);
    } catch (error) {
      if (error instanceof LiveBrowserError) throw error;
      throw new LiveBrowserError("INVALID_INPUT", "The live API request failed safely.", {
        cause: error,
      });
    }
    const rawText = Buffer.from(raw.body).toString("utf8");
    const redactedBody = redactLiveApiText(
      rawText.replace(/\uFFFD$/u, ""),
      this.#redactionValues,
      raw.bodyTruncated,
    );
    if (redactedBody !== rawText) {
      state.secretTainted = true;
      state.recordingSecretTainted = true;
    }
    const boundedBody = boundedUtf8(redactedBody, this.#budgets.maxApiResponseBytes);
    const assertionBodyText = boundedBody.value;
    const bodyPreview = boundedUtf8(assertionBodyText, 4_000).value;
    const contentType =
      raw.contentType === undefined
        ? undefined
        : boundedUtf8(this.#redact(raw.contentType), 256).value;
    return {
      name,
      side,
      stateVersion: state.version,
      method: request.method,
      path: request.path,
      requestFingerprint: sha256(JSON.stringify(request)),
      status: raw.status,
      ...(contentType === undefined ? {} : { contentType }),
      bodySha256: sha256(assertionBodyText),
      bodyPreview,
      bodyTruncated: raw.bodyTruncated || boundedBody.truncated,
      capturedByteSize: Buffer.byteLength(assertionBodyText, "utf8"),
      assertionBodyText,
    };
  }

  #commitApiResponse(pending: PendingApiResponse): LiveApiResponseRecord {
    const record: LiveApiResponseRecord = {
      id: this.#opaqueId("response"),
      name: pending.name,
      sequence: ++this.#apiResponseSequence,
      side: pending.side,
      stateVersion: pending.stateVersion,
      method: pending.method,
      path: pending.path,
      requestFingerprint: pending.requestFingerprint,
      status: pending.status,
      ...(pending.contentType === undefined ? {} : { contentType: pending.contentType }),
      bodySha256: pending.bodySha256,
      bodyPreview: pending.bodyPreview,
      bodyTruncated: pending.bodyTruncated,
      capturedByteSize: pending.capturedByteSize,
      createdAt: this.#timestamp(),
    };
    this.#apiResponses.push(record);
    this.#apiResponseBodies.set(record.id, pending.assertionBodyText);
    return record;
  }

  #requireCheckpointCapacity(
    requested: readonly { readonly side: ReviewSide; readonly name: string }[],
  ): void {
    if (this.#checkpoints.length + requested.length > this.#budgets.maxCheckpoints) {
      throw new LiveBrowserError("ARTIFACT_LIMIT", "Session checkpoint limit is exhausted.");
    }
    for (const { side, name } of requested) {
      if (
        this.#checkpoints.some((checkpoint) => checkpoint.side === side && checkpoint.name === name)
      ) {
        throw new LiveBrowserError("INVALID_INPUT", "Checkpoint names must be unique per side.");
      }
    }
  }

  async #prepareCheckpoint(
    side: ReviewSide,
    name: string,
    signal: AbortSignal,
    pendingArtifactBytes: number,
  ): Promise<PendingCheckpoint> {
    const state = this.#side(side);
    const path = this.#safeCurrentPath(side, state.controller);
    if (state.secretTainted) {
      return {
        name,
        side,
        stateVersion: state.version,
        path,
        captured: false,
      };
    }

    const bytes = await state.controller.screenshot(signal);
    if (bytes.byteLength === 0 || bytes.byteLength > this.#budgets.maxArtifactBytes) {
      throw new LiveBrowserError("ARTIFACT_LIMIT", "Checkpoint exceeds the per-artifact limit.");
    }
    if (
      this.#totalArtifactBytes + pendingArtifactBytes + bytes.byteLength >
      this.#budgets.maxTotalArtifactBytes
    ) {
      throw new LiveBrowserError("ARTIFACT_LIMIT", "Checkpoint exceeds the review artifact limit.");
    }
    return {
      name,
      side,
      stateVersion: state.version,
      path,
      captured: true,
      bytes: Uint8Array.from(bytes),
      digest: sha256(bytes),
    };
  }

  #commitCheckpoint(pending: PendingCheckpoint): LiveCheckpointRecord {
    if (!pending.captured || !pending.bytes || !pending.digest) {
      const checkpoint: LiveCheckpointRecord = {
        name: pending.name,
        side: pending.side,
        stateVersion: pending.stateVersion,
        path: pending.path,
        captured: false,
        createdAt: this.#timestamp(),
      };
      this.#checkpoints.push(checkpoint);
      return checkpoint;
    }

    const artifactId = this.#opaqueDigestId(
      "artifact",
      `${pending.side}\0${pending.name}\0${pending.digest}`,
    );
    const metadata = {
      artifactId,
      digest: pending.digest,
      byteSize: pending.bytes.byteLength,
      mediaType: "image/png" as const,
    };
    this.#artifacts.set(artifactId, {
      metadata,
      bytes: Uint8Array.from(pending.bytes),
    });
    this.#totalArtifactBytes += pending.bytes.byteLength;
    const checkpoint: LiveCheckpointRecord = {
      ...metadata,
      name: pending.name,
      side: pending.side,
      stateVersion: pending.stateVersion,
      path: pending.path,
      captured: true,
      createdAt: this.#timestamp(),
    };
    this.#checkpoints.push(checkpoint);
    return checkpoint;
  }

  async #interaction(
    tool: "browser_click" | "browser_fill" | "browser_press" | "browser_select",
    side: ReviewSide,
    observationId: string,
    locator: TestLocator,
    inputSummary: Readonly<Record<string, unknown>>,
    externalSignal: AbortSignal | undefined,
    action: (controller: LiveBrowserSideController, signal: AbortSignal) => Promise<void>,
  ): Promise<LiveActionResult> {
    return this.#tool(tool, side, inputSummary, externalSignal, async ({ signal }) => {
      const state = this.#requireObservation(side, observationId);
      this.#invalidate(side);
      const count = await state.controller.count(locator, signal);
      if (count !== 1) {
        throw new LiveBrowserError(
          "LOCATOR_NOT_UNIQUE",
          `Semantic locator resolved to ${count} elements; exactly one is required.`,
        );
      }
      await action(state.controller, signal);
      const path = this.#safeCurrentPath(side, state.controller);
      return {
        value: { side, stateVersion: state.version, path },
        result: `action completed at ${path}`,
        observationId,
        stateVersion: state.version,
      };
    });
  }

  async #tool<T>(
    tool: Exclude<LiveToolName, "finish_review">,
    side: ReviewSide | undefined,
    input: Readonly<Record<string, unknown>>,
    externalSignal: AbortSignal | undefined,
    operation: (context: ToolContext) => Promise<{
      readonly value: T;
      readonly result: string;
      readonly observationId?: string;
      readonly stateVersion?: number;
    }>,
  ): Promise<T> {
    return this.#exclusive(async () => {
      const startedAt = this.#timestamp();
      const evidenceSequence = ++this.#evidenceSequence;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let operationSignal: AbortSignal | undefined;
      try {
        this.#ensureActive();
        this.#consumeAction();
        const expiresAtMs = this.#expiresAtMs;
        if (expiresAtMs === undefined) {
          throw new Error("Live browser session deadline was not initialized.");
        }
        const remainingMs = expiresAtMs - this.#now().getTime();
        if (remainingMs <= 0) {
          this.#terminalState = "timed_out";
          this.#sessionAbort.abort(
            new LiveBrowserError("TIME_BUDGET_EXHAUSTED", "Session time budget is exhausted."),
          );
          void this.#runtime.close().catch(() => undefined);
          throw new LiveBrowserError("TIME_BUDGET_EXHAUSTED", "Session time budget is exhausted.");
        }
        const timeout = new AbortController();
        const timeoutMs = Math.min(this.#budgets.toolTimeoutMs, remainingMs);
        const deadlineLimited = remainingMs <= this.#budgets.toolTimeoutMs;
        timer = setTimeout(() => {
          const timeoutError = new LiveBrowserError(
            deadlineLimited ? "TIME_BUDGET_EXHAUSTED" : "TOOL_TIMEOUT",
            deadlineLimited ? "Session time budget is exhausted." : "Browser tool timed out.",
          );
          if (deadlineLimited) this.#terminalState = "timed_out";
          timeout.abort(timeoutError);
        }, timeoutMs);
        const signals = [this.#sessionAbort.signal, timeout.signal];
        if (externalSignal) signals.push(externalSignal);
        const signal = AbortSignal.any(signals);
        operationSignal = signal;
        signal.throwIfAborted();
        const completed = await operation({ signal, startedAt, evidenceSequence });
        signal.throwIfAborted();
        this.#ledger.push({
          id: this.#opaqueId("evidence"),
          sequence: evidenceSequence,
          tool,
          ...(side ? { side } : {}),
          ...(completed.stateVersion === undefined ? {} : { stateVersion: completed.stateVersion }),
          ...(completed.observationId ? { observationId: completed.observationId } : {}),
          input,
          startedAt,
          completedAt: this.#timestamp(),
          outcome: "success",
          result: boundedUtf8(this.#redact(completed.result), 2_000).value,
        });
        return completed.value;
      } catch (error) {
        const normalized = this.#normalizeAbort(error, externalSignal, operationSignal);
        this.#ledger.push({
          id: this.#opaqueId("evidence"),
          sequence: evidenceSequence,
          tool,
          ...(side ? { side, stateVersion: this.#sides.get(side)?.version ?? 0 } : {}),
          input,
          startedAt,
          completedAt: this.#timestamp(),
          outcome: "error",
          result: boundedUtf8(this.#redact(errorMessage(normalized)), 2_000).value,
          ...(normalized instanceof LiveBrowserError ? { errorCode: normalized.code } : {}),
        });
        throw normalized;
      } finally {
        if (timer) clearTimeout(timer);
      }
    });
  }

  async #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#exclusiveTail;
    let release: (() => void) | undefined;
    this.#exclusiveTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
    }
  }

  #side(side: ReviewSide): SideState {
    const state = this.#sides.get(side);
    if (!state)
      throw new LiveBrowserError("SESSION_SEALED", `${side} browser context is unavailable.`);
    return state;
  }

  #requireObservation(side: ReviewSide, observationId: string): SideState {
    const state = this.#side(side);
    if (
      !state.observation ||
      state.observation.id !== observationId ||
      state.observation.stateVersion !== state.version
    ) {
      throw new LiveBrowserError(
        "STALE_OBSERVATION",
        "Observation is missing, stale, or belongs to another browser side.",
      );
    }
    return state;
  }

  #invalidate(side: ReviewSide): SideState {
    const state = this.#side(side);
    state.version += 1;
    delete state.observation;
    return state;
  }

  #consumeAction(): void {
    if (this.#actionsUsed >= this.#budgets.maxActions) {
      throw new LiveBrowserError("ACTION_BUDGET_EXHAUSTED", "Session action budget is exhausted.");
    }
    this.#actionsUsed += 1;
  }

  #ensureActive(): void {
    if (this.#terminalState !== "active") {
      const code =
        this.#terminalState === "cancelled"
          ? "CANCELLED"
          : this.#terminalState === "timed_out"
            ? "TIME_BUDGET_EXHAUSTED"
            : "SESSION_SEALED";
      throw new LiveBrowserError(code, `Session is ${this.#terminalState}.`);
    }
    if (this.#expiresAtMs === undefined) {
      this.#expiresAtMs = this.#now().getTime() + this.#budgets.maxDurationMs;
    }
  }

  #safeCurrentPath(side: ReviewSide, controller: LiveBrowserSideController): string {
    return boundedUtf8(
      this.#redact(relativePath(controller.currentUrl(), this.#origins[side])),
      2_000,
    ).value;
  }

  #rejectSecretBearingPath(path: string): void {
    let candidate = path.replace(/\+/g, " ");
    for (let depth = 0; depth < 3; depth += 1) {
      if (this.#redact(candidate) !== candidate) {
        throw new LiveBrowserError(
          "INVALID_INPUT",
          "Secret values are forbidden in browser paths.",
        );
      }
      try {
        const decoded = decodeURIComponent(candidate);
        if (decoded === candidate) return;
        candidate = decoded;
      } catch {
        return;
      }
    }
    if (this.#redact(candidate) !== candidate) {
      throw new LiveBrowserError("INVALID_INPUT", "Secret values are forbidden in browser paths.");
    }
  }

  #recordBrowserEvent(side: ReviewSide, event: LiveBrowserRawEvent): void {
    if (this.#events.length >= maximumStoredBrowserEvents) return;
    const boundedEvent: LiveBrowserRawEvent =
      this.#events.length === maximumStoredBrowserEvents - 1
        ? {
            kind: "console",
            level: "warning",
            message: "Browser event limit reached; additional events were omitted.",
          }
        : event;
    const sequence = ++this.#eventSequence;
    let url: string | undefined;
    if (boundedEvent.url) {
      try {
        url = relativePath(boundedEvent.url, this.#origins[side]);
      } catch {
        url = "[cross-origin]";
      }
    }
    this.#events.push({
      id: this.#opaqueId("event"),
      sequence,
      side,
      at: this.#timestamp(),
      kind: boundedEvent.kind,
      level: boundedEvent.level,
      message: boundedUtf8(this.#redact(boundedEvent.message), 8_000).value,
      ...(url ? { url: boundedUtf8(this.#redact(url), 2_000).value } : {}),
      ...(boundedEvent.status === undefined ? {} : { status: boundedEvent.status }),
    });
  }

  #locatorSummary(locator: TestLocator): Readonly<Record<string, unknown>> {
    switch (locator.kind) {
      case "role":
        return {
          kind: locator.kind,
          role: locator.role,
          name: this.#redact(locator.name),
          exact: locator.exact,
        };
      case "label":
        return { kind: locator.kind, text: this.#redact(locator.text) };
      case "text":
        return { kind: locator.kind, text: this.#redact(locator.text), exact: locator.exact };
      case "test_id":
        return { kind: locator.kind, value: this.#redact(locator.value) };
    }
  }

  #requireBrowserAssertionName(side: ReviewSide, name: string): void {
    if (this.#assertions.some((assertion) => assertion.side === side && assertion.name === name)) {
      throw new LiveBrowserError(
        "INVALID_INPUT",
        `Assertion name ${name} is already recorded for ${side}.`,
      );
    }
  }

  async #prepareBrowserAssertion(
    side: ReviewSide,
    name: string,
    expected: LiveAssertion,
    signal: AbortSignal,
  ): Promise<PendingBrowserAssertion> {
    this.#requireBrowserAssertionName(side, name);
    const state = this.#side(side);
    const path = this.#safeCurrentPath(side, state.controller);
    let passed: boolean;
    let expectedText: string;
    let actualText: string;
    if (expected.kind === "url") {
      passed = path.includes(expected.includes);
      expectedText = `path containing ${expected.includes}`;
      actualText = path;
    } else {
      const count = await state.controller.count(expected.target, signal);
      if (expected.kind === "visible" || expected.kind === "hidden") {
        if (count > 1) {
          throw new LiveBrowserError(
            "LOCATOR_NOT_UNIQUE",
            `Assertion locator resolved to ${count} elements; at most one is allowed.`,
          );
        }
        const visible = count === 1 && (await state.controller.isVisible(expected.target, signal));
        const desired = expected.kind === "visible";
        passed = visible === desired;
        expectedText = desired ? "visible" : "hidden";
        actualText = visible ? "visible" : "hidden";
      } else {
        if (count !== 1) {
          throw new LiveBrowserError(
            "LOCATOR_NOT_UNIQUE",
            `Assertion locator resolved to ${count} elements; exactly one is required.`,
          );
        }
        const text = await state.controller.textContent(expected.target, signal);
        passed = text.includes(expected.includes);
        expectedText = `text containing ${expected.includes}`;
        actualText = text;
      }
    }
    const redactedActual = this.#redact(actualText);
    if (redactedActual !== actualText) {
      state.secretTainted = true;
      state.recordingSecretTainted = true;
    }
    return {
      name,
      side,
      stateVersion: state.version,
      path,
      kind: expected.kind,
      locatorFingerprint: sha256(
        JSON.stringify(expected.kind === "url" ? { kind: "url" } : expected.target),
      ),
      passed,
      expected: boundedUtf8(this.#redact(expectedText), 1_000).value,
      actual: boundedUtf8(redactedActual, 2_000).value,
    };
  }

  #commitBrowserAssertion(pending: PendingBrowserAssertion): LiveAssertionRecord {
    const assertion: LiveAssertionRecord = {
      id: this.#opaqueId("assert"),
      sequence: ++this.#assertionSequence,
      createdAt: this.#timestamp(),
      ...pending,
    };
    this.#assertions.push(assertion);
    return assertion;
  }

  #assertionSummary(assertion: LiveAssertion): Readonly<Record<string, unknown>> {
    if (assertion.kind === "url") {
      return { kind: assertion.kind, includes: this.#redact(assertion.includes) };
    }
    return {
      kind: assertion.kind,
      target: this.#locatorSummary(assertion.target),
      ...(assertion.kind === "text" ? { includes: this.#redact(assertion.includes) } : {}),
    };
  }

  #redact(value: string): string {
    return redactText(value, this.#redactionValues);
  }

  #timestamp(): string {
    const candidate = this.#now().getTime();
    this.#lastTimestampMs = Math.max(candidate, this.#lastTimestampMs + 1);
    return new Date(this.#lastTimestampMs).toISOString();
  }

  #opaqueId(prefix: string): string {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const candidate = `${prefix}:${sha256(`${prefix}\0${this.#idFactory()}\0${attempt}`)}`;
      if (!this.#usedIds.has(candidate)) {
        this.#usedIds.add(candidate);
        return candidate;
      }
    }
    const fallback = `${prefix}:${sha256(randomUUID())}`;
    this.#usedIds.add(fallback);
    return fallback;
  }

  #opaqueDigestId(prefix: string, source: string): string {
    let nonce = "";
    let candidate = `${prefix}:${sha256(source)}`;
    while (this.#usedIds.has(candidate)) {
      nonce = this.#idFactory();
      candidate = `${prefix}:${sha256(`${source}\0${nonce}`)}`;
    }
    this.#usedIds.add(candidate);
    return candidate;
  }

  #normalizeAbort(
    error: unknown,
    externalSignal: AbortSignal | undefined,
    operationSignal: AbortSignal | undefined,
  ): unknown {
    if (error instanceof LiveBrowserError) return error;
    if (operationSignal?.aborted && operationSignal.reason instanceof LiveBrowserError) {
      return operationSignal.reason;
    }
    if (externalSignal?.aborted) {
      return new LiveBrowserError("CANCELLED", "Browser tool was cancelled.", { cause: error });
    }
    if (this.#sessionAbort.signal.aborted) {
      return new LiveBrowserError(
        this.#terminalState === "cancelled"
          ? "CANCELLED"
          : this.#terminalState === "timed_out"
            ? "TIME_BUDGET_EXHAUSTED"
            : "SESSION_SEALED",
        `Session is ${this.#terminalState}.`,
        { cause: error },
      );
    }
    return error;
  }

  static #validatedOrigin(value: string): string {
    let url: URL;
    try {
      url = new URL(value);
    } catch (error) {
      throw new LiveBrowserError("INVALID_INPUT", "Browser origin must be an absolute HTTP URL.", {
        cause: error,
      });
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      throw new LiveBrowserError(
        "INVALID_INPUT",
        "Browser origin must contain only scheme and authority.",
      );
    }
    return url.origin;
  }

  static #validatedBudgets(overrides: Partial<LiveBrowserBudgets> | undefined): LiveBrowserBudgets {
    const budgets = { ...defaultBudgets, ...overrides };
    const entries = Object.entries(budgets);
    if (entries.some(([, value]) => !Number.isSafeInteger(value) || value <= 0)) {
      throw new LiveBrowserError(
        "INVALID_INPUT",
        "Browser budgets must be positive safe integers.",
      );
    }
    const exceedsPolicyCeiling =
      budgets.maxActions > defaultBudgets.maxActions ||
      budgets.maxDurationMs > defaultBudgets.maxDurationMs ||
      budgets.maxCheckpoints > defaultBudgets.maxCheckpoints ||
      budgets.maxResets > defaultBudgets.maxResets ||
      budgets.toolTimeoutMs > defaultBudgets.toolTimeoutMs ||
      budgets.maxSnapshotBytes > defaultBudgets.maxSnapshotBytes ||
      budgets.maxEventsPerRead > defaultBudgets.maxEventsPerRead ||
      budgets.maxApiResponseBytes > defaultBudgets.maxApiResponseBytes ||
      budgets.maxArtifactBytes > defaultBudgets.maxArtifactBytes ||
      budgets.maxTotalArtifactBytes > defaultBudgets.maxTotalArtifactBytes;
    if (exceedsPolicyCeiling) {
      throw new LiveBrowserError(
        "INVALID_INPUT",
        "Browser budgets exceed the server policy ceiling.",
      );
    }
    return Object.freeze(budgets);
  }
}
