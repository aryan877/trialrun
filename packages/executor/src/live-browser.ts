import { createHash, randomUUID } from "node:crypto";

import {
  redactText,
  testStepSchema,
  type BrowserEvent,
  type TestLocator,
  type TestStep,
} from "@trialrun/domain";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "playwright";

import type { ReviewSide } from "./types";

export type LiveFillValue = Extract<TestStep, { action: "fill" }>["value"];
export type LiveSelectOption = Extract<TestStep, { action: "select" }>["option"];
export type LivePressKey = Extract<TestStep, { action: "press" }>["key"];
export type LiveAssertion = Extract<TestStep, { action: "assert" }>["assertion"];
export type LiveNavigationWaitUntil = Extract<TestStep, { action: "goto" }>["waitUntil"];

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
  maxArtifactBytes: 128 * 1_024 * 1_024,
  maxTotalArtifactBytes: 384 * 1_024 * 1_024,
};

const maximumStoredBrowserEvents = 10_000;

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
  screenshot(signal: AbortSignal): Promise<Uint8Array>;
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
  readonly kind: LiveAssertion["kind"];
  readonly locatorFingerprint: string;
  readonly passed: boolean;
  readonly expected: string;
  readonly actual: string;
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
  | "browser_assert"
  | "browser_checkpoint"
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
  readonly checkpoints: readonly LiveCheckpointRecord[];
  readonly matchedCheckpointNames: readonly string[];
  readonly events: readonly LiveBrowserEvent[];
}

interface SideState {
  controller: LiveBrowserSideController;
  version: number;
  observation?: LiveBrowserObservation;
  secretTainted: boolean;
}

interface StoredArtifact {
  readonly metadata: {
    readonly artifactId: string;
    readonly byteSize: number;
    readonly digest: string;
    readonly mediaType: "image/png";
  };
  readonly bytes: Uint8Array;
}

interface ToolContext {
  readonly signal: AbortSignal;
  readonly startedAt: string;
  readonly evidenceSequence: number;
}

type GotoStep = Extract<TestStep, { action: "goto" }>;
type ClickStep = Extract<TestStep, { action: "click" }>;
type FillStep = Extract<TestStep, { action: "fill" }>;
type SelectStep = Extract<TestStep, { action: "select" }>;
type PressStep = Extract<TestStep, { action: "press" }>;
type AssertStep = Extract<TestStep, { action: "assert" }>;
type CheckpointStep = Extract<TestStep, { action: "checkpoint" }>;
type LiveStepAction = Exclude<TestStep["action"], "request">;

function parseStep(candidate: unknown, action: "goto"): GotoStep;
function parseStep(candidate: unknown, action: "click"): ClickStep;
function parseStep(candidate: unknown, action: "fill"): FillStep;
function parseStep(candidate: unknown, action: "select"): SelectStep;
function parseStep(candidate: unknown, action: "press"): PressStep;
function parseStep(candidate: unknown, action: "assert"): AssertStep;
function parseStep(candidate: unknown, action: "checkpoint"): CheckpointStep;
function parseStep(candidate: unknown, action: LiveStepAction): Exclude<TestStep, { action: "request" }> {
  const parsed = testStepSchema.safeParse(candidate);
  if (!parsed.success || parsed.data.action === "request" || parsed.data.action !== action) {
    throw new LiveBrowserError("INVALID_INPUT", `Invalid ${action} input.`);
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

function boundedUtf8(value: string, maximumBytes: number): { readonly value: string; readonly truncated: boolean } {
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
    value: `${encoded.subarray(0, contentLimit).toString("utf8").replace(/\uFFFD$/u, "")}${suffix}`,
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
  #closed = false;

  constructor(context: BrowserContext, page: Page, origin: string) {
    this.#context = context;
    this.#page = page;
    this.#origin = origin;
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

  async screenshot(signal: AbortSignal): Promise<Uint8Array> {
    return this.#run(signal, () =>
      this.#page.screenshot({ animations: "disabled", fullPage: false, type: "png" }),
    );
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#context.close();
  }

  #assertSameOrigin(): void {
    relativePath(this.#page.url(), this.#origin);
  }

  async #run<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    const closeOnAbort = (): void => {
      void this.close().catch(() => undefined);
    };
    signal.addEventListener("abort", closeOnAbort, { once: true });
    try {
      return await operation();
    } finally {
      signal.removeEventListener("abort", closeOnAbort);
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
    const context = await this.#browser.newContext({
      viewport: { width: 1_440, height: 900 },
      locale: "en-US",
      timezoneId: "UTC",
      colorScheme: "dark",
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    const page = await context.newPage();
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
    const controller = new PlaywrightSideController(context, page, origin);
    this.#controllers.add(controller);
    try {
      const initializationController = new AbortController();
      const timer = setTimeout(
        () => initializationController.abort(new Error("Initial browser navigation timed out.")),
        20_000,
      );
      try {
        await controller.navigate(`${origin}/`, "domcontentloaded", initializationController.signal);
      } finally {
        clearTimeout(timer);
      }
      return controller;
    } catch (error) {
      this.#controllers.delete(controller);
      await controller.close();
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
  readonly #checkpoints: LiveCheckpointRecord[] = [];
  readonly #events: LiveBrowserEvent[] = [];
  readonly #eventCursors = new Map<string, { readonly side: ReviewSide; readonly index: number }>();
  readonly #artifacts = new Map<string, StoredArtifact>();
  #actionsUsed = 0;
  #resetsUsed = 0;
  #evidenceSequence = 0;
  #assertionSequence = 0;
  #eventSequence = 0;
  #lastTimestampMs = 0;
  #totalArtifactBytes = 0;
  #terminalState: LiveBrowserTerminalState = "active";
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
        runtime.createSide("base", origins.base, (event) => session.#recordBrowserEvent("base", event)),
        runtime.createSide("head", origins.head, (event) => session.#recordBrowserEvent("head", event)),
      ]);
      session.#sides.set("base", { controller: base, version: 0, secretTainted: false });
      session.#sides.set("head", { controller: head, version: 0, secretTainted: false });
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
      checkpointsRemaining: Math.max(
        0,
        this.#budgets.maxCheckpoints - this.#checkpoints.length,
      ),
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
      this.#assertions
        .filter((assertion) => assertion.side === "base")
        .map(({ name }) => name),
    );
    const matchedAssertionNames = [
      ...new Set(
        this.#assertions
          .filter(
            (assertion) =>
              assertion.side === "head" && baseAssertionNames.has(assertion.name),
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
      checkpoints: this.#checkpoints.map((checkpoint) => ({ ...checkpoint })),
      matchedCheckpointNames,
      events: this.#events.map((event) => ({ ...event })),
    };
  }

  async observe(
    input: { readonly side: ReviewSide; readonly signal?: AbortSignal },
  ): Promise<LiveBrowserObservation> {
    return this.#tool(
      "browser_observe",
      input.side,
      {},
      input.signal,
      async ({ signal }) => {
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
      },
    );
  }

  async navigate(input: {
    readonly side: ReviewSide;
    readonly path: string;
    readonly waitUntil?: LiveNavigationWaitUntil;
    readonly signal?: AbortSignal;
  }): Promise<LiveActionResult> {
    const step = parseStep(
      { action: "goto", path: input.path, waitUntil: input.waitUntil ?? "domcontentloaded" },
      "goto",
    );
    return this.#tool(
      "browser_navigate",
      input.side,
      { path: this.#redact(step.path), waitUntil: step.waitUntil },
      input.signal,
      async ({ signal }) => {
        this.#rejectSecretBearingPath(step.path);
        const state = this.#invalidate(input.side);
        const target = new URL(step.path, `${this.#origins[input.side]}/`);
        if (target.origin !== this.#origins[input.side]) {
          throw new LiveBrowserError("SAME_ORIGIN_REQUIRED", "Navigation must remain on the assigned origin.");
        }
        await state.controller.navigate(target.href, step.waitUntil, signal);
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
    const locator = parseStep(
      { action: "click", target: input.locator },
      "click",
    ).target;
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
    const locator = parseStep(
      { action: "click", target: input.locator },
      "click",
    ).target;
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
    const step = parseStep(
      { action: "fill", target: input.locator, value: input.value },
      "fill",
    );
    const result = await this.#interaction(
      "browser_fill",
      input.side,
      input.observationId,
      step.target,
      {
        observationId: input.observationId,
        locator: this.#locatorSummary(step.target),
        value:
          step.value.kind === "secret"
            ? { kind: "secret", name: step.value.name }
            : { kind: "literal", length: step.value.value.length },
      },
      input.signal,
      async (controller, signal) => {
        const suppliedValue =
          step.value.kind === "literal" ? step.value.value : this.#secrets[step.value.name];
        if (suppliedValue === undefined) {
          throw new LiveBrowserError("SECRET_NOT_APPROVED", "Requested secret name is not approved.");
        }
        await controller.fill(step.target, suppliedValue, signal);
      },
    );
    if (step.value.kind === "secret") this.#side(input.side).secretTainted = true;
    return result;
  }

  async select(input: {
    readonly side: ReviewSide;
    readonly observationId: string;
    readonly locator: TestLocator;
    readonly option: LiveSelectOption;
    readonly signal?: AbortSignal;
  }): Promise<LiveActionResult> {
    const step = parseStep(
      { action: "select", target: input.locator, option: input.option },
      "select",
    );
    return this.#interaction(
      "browser_select",
      input.side,
      input.observationId,
      step.target,
      {
        observationId: input.observationId,
        locator: this.#locatorSummary(step.target),
        option: step.option,
      },
      input.signal,
      async (controller, signal) => {
        await controller.select(step.target, step.option, signal);
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
    const step = parseStep(
      { action: "press", target: input.locator, key: input.key },
      "press",
    );
    return this.#interaction(
      "browser_press",
      input.side,
      input.observationId,
      step.target,
      {
        observationId: input.observationId,
        locator: this.#locatorSummary(step.target),
        key: step.key,
      },
      input.signal,
      (controller, signal) => controller.press(step.target, step.key, signal),
    );
  }

  async assert(input: {
    readonly side: ReviewSide;
    readonly name: string;
    readonly assertion: LiveAssertion;
    readonly signal?: AbortSignal;
  }): Promise<LiveAssertionRecord> {
    const expected = parseStep(
      { action: "assert", assertion: input.assertion },
      "assert",
    ).assertion;
    const name = parseStep({ action: "checkpoint", name: input.name }, "checkpoint").name;
    return this.#tool(
      "browser_assert",
      input.side,
      { name, assertion: this.#assertionSummary(expected) },
      input.signal,
      async ({ signal }) => {
        const state = this.#side(input.side);
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
        const path = this.#safeCurrentPath(input.side, state.controller);
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
        if (redactedActual !== actualText) state.secretTainted = true;
        const assertion: LiveAssertionRecord = {
          id: this.#opaqueId("assert"),
          name,
          sequence: ++this.#assertionSequence,
          side: input.side,
          stateVersion: state.version,
          path,
          kind: expected.kind,
          locatorFingerprint: sha256(
            JSON.stringify(expected.kind === "url" ? { kind: "url" } : expected.target),
          ),
          passed,
          expected: boundedUtf8(this.#redact(expectedText), 1_000).value,
          actual: boundedUtf8(redactedActual, 2_000).value,
          createdAt: this.#timestamp(),
        };
        this.#assertions.push(assertion);
        return {
          value: assertion,
          result: `assertion ${assertion.id} ${passed ? "passed" : "failed"}`,
          stateVersion: state.version,
        };
      },
    );
  }

  async checkpoint(input: {
    readonly side: ReviewSide;
    readonly name: string;
    readonly signal?: AbortSignal;
  }): Promise<LiveCheckpointRecord> {
    const name = parseStep(
      { action: "checkpoint", name: input.name },
      "checkpoint",
    ).name;
    return this.#tool(
      "browser_checkpoint",
      input.side,
      { name },
      input.signal,
      async ({ signal }) => {
        const state = this.#side(input.side);
        const path = this.#safeCurrentPath(input.side, state.controller);
        if (this.#checkpoints.length >= this.#budgets.maxCheckpoints) {
          throw new LiveBrowserError("ARTIFACT_LIMIT", "Session checkpoint limit is exhausted.");
        }
        if (this.#checkpoints.some((checkpoint) => checkpoint.side === input.side && checkpoint.name === name)) {
          throw new LiveBrowserError("INVALID_INPUT", "Checkpoint names must be unique per side.");
        }
        let checkpoint: LiveCheckpointRecord;
        if (state.secretTainted) {
          checkpoint = {
            name,
            side: input.side,
            stateVersion: state.version,
            path,
            captured: false,
            createdAt: this.#timestamp(),
          };
        } else {
          const bytes = await state.controller.screenshot(signal);
          if (bytes.byteLength === 0 || bytes.byteLength > this.#budgets.maxArtifactBytes) {
            throw new LiveBrowserError("ARTIFACT_LIMIT", "Checkpoint exceeds the per-artifact limit.");
          }
          if (this.#totalArtifactBytes + bytes.byteLength > this.#budgets.maxTotalArtifactBytes) {
            throw new LiveBrowserError("ARTIFACT_LIMIT", "Checkpoint exceeds the review artifact limit.");
          }
          const digest = sha256(bytes);
          const artifactId = this.#opaqueDigestId("artifact", `${input.side}\0${name}\0${digest}`);
          const metadata: StoredArtifact["metadata"] = {
            artifactId,
            digest,
            byteSize: bytes.byteLength,
            mediaType: "image/png",
          };
          this.#artifacts.set(artifactId, { metadata, bytes: Uint8Array.from(bytes) });
          this.#totalArtifactBytes += bytes.byteLength;
          checkpoint = {
            ...metadata,
            name,
            side: input.side,
            stateVersion: state.version,
            path,
            captured: true,
            createdAt: this.#timestamp(),
          };
        }
        this.#checkpoints.push(checkpoint);
        return {
          value: checkpoint,
          result: checkpoint.captured
            ? `checkpoint ${name} captured as ${checkpoint.artifactId}`
            : `checkpoint ${name} withheld by secret-safe policy`,
          stateVersion: state.version,
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
        const events = sideEvents.slice(startingIndex, startingIndex + this.#budgets.maxEventsPerRead);
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
    return this.#tool(
      "browser_reset",
      input.side,
      {},
      input.signal,
      async ({ signal }) => {
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
      },
    );
  }

  async seal(state: Exclude<LiveBrowserTerminalState, "active"> = "finished"): Promise<LiveBrowserEvidence> {
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
      try {
        await this.#runtime.close();
      } catch (error) {
        outcome = "error";
        result = this.#redact(errorMessage(error));
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
      return this.evidence();
    });
    this.#sealPromise = sealPromise;
    return sealPromise;
  }

  async cancel(): Promise<LiveBrowserEvidence> {
    return this.seal("cancelled");
  }

  artifact(artifactId: string): Uint8Array {
    if (this.#terminalState === "active") {
      throw new LiveBrowserError("SESSION_SEALED", "Artifacts are available only after evidence is sealed.");
    }
    const artifact = this.#artifacts.get(artifactId);
    if (!artifact) throw new LiveBrowserError("INVALID_INPUT", "Artifact ID is not in the sealed manifest.");
    return Uint8Array.from(artifact.bytes);
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
    side: ReviewSide,
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
          side,
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
          side,
          stateVersion: this.#sides.get(side)?.version ?? 0,
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
    if (!state) throw new LiveBrowserError("SESSION_SEALED", `${side} browser context is unavailable.`);
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
        throw new LiveBrowserError("INVALID_INPUT", "Secret values are forbidden in browser paths.");
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
      throw new LiveBrowserError("INVALID_INPUT", "Browser origin must contain only scheme and authority.");
    }
    return url.origin;
  }

  static #validatedBudgets(overrides: Partial<LiveBrowserBudgets> | undefined): LiveBrowserBudgets {
    const budgets = { ...defaultBudgets, ...overrides };
    const entries = Object.entries(budgets);
    if (entries.some(([, value]) => !Number.isSafeInteger(value) || value <= 0)) {
      throw new LiveBrowserError("INVALID_INPUT", "Browser budgets must be positive safe integers.");
    }
    const exceedsPolicyCeiling =
      budgets.maxActions > defaultBudgets.maxActions ||
      budgets.maxDurationMs > defaultBudgets.maxDurationMs ||
      budgets.maxCheckpoints > defaultBudgets.maxCheckpoints ||
      budgets.maxResets > defaultBudgets.maxResets ||
      budgets.toolTimeoutMs > defaultBudgets.toolTimeoutMs ||
      budgets.maxSnapshotBytes > defaultBudgets.maxSnapshotBytes ||
      budgets.maxEventsPerRead > defaultBudgets.maxEventsPerRead ||
      budgets.maxArtifactBytes > defaultBudgets.maxArtifactBytes ||
      budgets.maxTotalArtifactBytes > defaultBudgets.maxTotalArtifactBytes;
    if (exceedsPolicyCeiling) {
      throw new LiveBrowserError("INVALID_INPUT", "Browser budgets exceed the server policy ceiling.");
    }
    return Object.freeze(budgets);
  }
}
