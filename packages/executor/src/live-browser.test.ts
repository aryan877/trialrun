import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  LiveBrowserError,
  LiveBrowserSession,
  maximumLiveBrowserRecordingArtifactBytes,
  type LiveBrowserBudgets,
  type LiveBrowserRawEvent,
  type LiveBrowserRuntime,
  type LiveBrowserSessionOptions,
  type LiveBrowserSideController,
  type LiveNavigationWaitUntil,
  type LivePressKey,
  type LiveSelectOption,
} from "./live-browser";
import type { TestLocator } from "@trialrun/domain";
import { liveBrowserEvidenceSchema } from "./live-protocol";
import type { ReviewSide } from "./types";

const origins = {
  base: "http://base.internal:3000",
  head: "http://head.internal:3000",
} as const;

const button: TestLocator = {
  kind: "role",
  role: "button",
  name: "Save",
  exact: true,
};

interface VoidDeferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

function voidDeferred(): VoidDeferred {
  let resolve = (): void => {
    throw new Error("Deferred promise was not initialized.");
  };
  const promise = new Promise<void>((resolved) => {
    resolve = resolved;
  });
  return { promise, resolve };
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("Operation aborted.");
}

class FakeSideController implements LiveBrowserSideController {
  readonly side: ReviewSide;
  readonly calls: string[] = [];
  readonly filledValues: string[] = [];
  readonly #timeline: string[];
  url: string;
  pageTitle = "TrialRun";
  snapshot = "- document: TrialRun";
  matchCount = 1;
  visible = true;
  text = "Saved successfully";
  screenshotBytes = Uint8Array.from([137, 80, 78, 71]);
  recordingBytes: Uint8Array;
  readonly recordingCaptureRequests: boolean[] = [];
  redirectUrl?: string;
  closed = false;
  hangSnapshot = false;
  readonly snapshotEntered = voidDeferred();
  recordingGate?: VoidDeferred;
  recordingEntered?: VoidDeferred;
  clickGate?: VoidDeferred;
  clickEntered?: VoidDeferred;

  constructor(side: ReviewSide, origin: string, timeline: string[]) {
    this.side = side;
    this.url = `${origin}/`;
    this.#timeline = timeline;
    this.recordingBytes = Uint8Array.from(
      side === "base" ? [26, 69, 223, 163, 66] : [26, 69, 223, 163, 72],
    );
  }

  currentUrl(): string {
    return this.url;
  }

  title(signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    this.#record("title");
    return Promise.resolve(this.pageTitle);
  }

  async accessibilitySnapshot(signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    this.#record("snapshot");
    this.snapshotEntered.resolve();
    if (!this.hangSnapshot) return this.snapshot;
    return new Promise<string>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(abortError(signal)), { once: true });
    });
  }

  viewport(): { readonly width: number; readonly height: number } {
    return { width: 1_440, height: 900 };
  }

  navigate(url: string, _waitUntil: LiveNavigationWaitUntil, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    this.#record("navigate");
    this.url = this.redirectUrl ?? url;
    delete this.redirectUrl;
    return Promise.resolve();
  }

  count(_locator: TestLocator, signal: AbortSignal): Promise<number> {
    signal.throwIfAborted();
    this.#record("count");
    return Promise.resolve(this.matchCount);
  }

  async click(_locator: TestLocator, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    this.#record("click");
    this.clickEntered?.resolve();
    if (this.clickGate) await this.clickGate.promise;
    signal.throwIfAborted();
  }

  fill(_locator: TestLocator, value: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    this.#record("fill");
    this.filledValues.push(value);
    return Promise.resolve();
  }

  select(_locator: TestLocator, _option: LiveSelectOption, signal: AbortSignal): Promise<number> {
    signal.throwIfAborted();
    this.#record("select");
    return Promise.resolve(1);
  }

  press(_locator: TestLocator, _key: LivePressKey, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    this.#record("press");
    return Promise.resolve();
  }

  isVisible(_locator: TestLocator, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    this.#record("isVisible");
    return Promise.resolve(this.visible);
  }

  textContent(_locator: TestLocator, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    this.#record("textContent");
    return Promise.resolve(this.text);
  }

  screenshot(signal: AbortSignal): Promise<Uint8Array> {
    signal.throwIfAborted();
    this.#record("screenshot");
    return Promise.resolve(Uint8Array.from(this.screenshotBytes));
  }

  async finishRecording(capture: boolean, maximumBytes: number): Promise<Uint8Array | undefined> {
    if (this.recordingCaptureRequests.length > 0) {
      return this.recordingCaptureRequests[0] === true
        ? Uint8Array.from(this.recordingBytes)
        : undefined;
    }
    this.recordingCaptureRequests.push(capture);
    this.closed = true;
    this.#record("finishRecording");
    this.recordingEntered?.resolve();
    if (this.recordingGate) await this.recordingGate.promise;
    if (!capture) return undefined;
    if (this.recordingBytes.byteLength > maximumBytes) {
      throw new LiveBrowserError("ARTIFACT_LIMIT", "Fake recording exceeds its artifact limit.");
    }
    return Uint8Array.from(this.recordingBytes);
  }

  close(): Promise<void> {
    if (this.recordingCaptureRequests.length > 0) return Promise.resolve();
    return this.finishRecording(false, maximumLiveBrowserRecordingArtifactBytes).then(
      () => undefined,
    );
  }

  #record(operation: string): void {
    this.calls.push(operation);
    this.#timeline.push(`${this.side}:${operation}`);
  }
}

class FakeRuntime implements LiveBrowserRuntime {
  readonly timeline: string[] = [];
  readonly #controllers: Record<ReviewSide, FakeSideController[]> = { base: [], head: [] };
  readonly #eventSinks: Record<ReviewSide, Array<(event: LiveBrowserRawEvent) => void>> = {
    base: [],
    head: [],
  };
  closeCount = 0;

  createSide(
    side: ReviewSide,
    origin: string,
    onEvent: (event: LiveBrowserRawEvent) => void,
  ): Promise<LiveBrowserSideController> {
    const controller = new FakeSideController(side, origin, this.timeline);
    this.#controllers[side].push(controller);
    this.#eventSinks[side].push(onEvent);
    return Promise.resolve(controller);
  }

  async close(): Promise<void> {
    this.closeCount += 1;
    await Promise.all(
      [...this.#controllers.base, ...this.#controllers.head].map((controller) =>
        controller.close(),
      ),
    );
  }

  latest(side: ReviewSide): FakeSideController {
    const controller = this.#controllers[side].at(-1);
    if (!controller) throw new Error(`${side} controller was not created.`);
    return controller;
  }

  all(side: ReviewSide): readonly FakeSideController[] {
    return this.#controllers[side];
  }

  emit(side: ReviewSide, event: LiveBrowserRawEvent): void {
    const sink = this.#eventSinks[side].at(-1);
    if (!sink) throw new Error(`${side} event sink was not created.`);
    sink(event);
  }
}

interface SessionFixture {
  readonly session: LiveBrowserSession;
  readonly runtime: FakeRuntime;
}

async function sessionFixture(
  options: {
    readonly secrets?: Readonly<Record<string, string>>;
    readonly budgets?: Partial<LiveBrowserBudgets>;
    readonly now?: () => Date;
  } = {},
): Promise<SessionFixture> {
  const runtime = new FakeRuntime();
  let nextId = 0;
  const sessionOptions: LiveBrowserSessionOptions = {
    origins,
    runtime,
    idFactory: () => `test-${++nextId}`,
    ...(options.secrets ? { secrets: options.secrets } : {}),
    ...(options.budgets ? { budgets: options.budgets } : {}),
    ...(options.now ? { now: options.now } : {}),
  };
  return { session: await LiveBrowserSession.create(sessionOptions), runtime };
}

function errorCode(error: unknown): string | undefined {
  return error instanceof LiveBrowserError ? error.code : undefined;
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("LiveBrowserSession observation fences", () => {
  it("returns a bounded snapshot and keeps raw DOM content out of stored observation evidence", async () => {
    const { session, runtime } = await sessionFixture({ budgets: { maxSnapshotBytes: 32 } });
    runtime.latest("base").snapshot = "semantic-content-".repeat(20);

    const observation = await session.observe({ side: "base" });
    expect(observation.snapshotTruncated).toBe(true);
    expect(Buffer.byteLength(observation.snapshot, "utf8")).toBeLessThanOrEqual(32);
    expect(JSON.stringify(session.evidence().observations)).not.toContain("semantic-content");
  });

  it("requires a current side-specific observation and invalidates it after every action attempt", async () => {
    const { session, runtime } = await sessionFixture();
    const base = runtime.latest("base");
    const observation = await session.observe({ side: "base" });

    await expect(
      session.count({ side: "head", observationId: observation.id, locator: button }),
    ).rejects.toSatisfy((error: unknown) => errorCode(error) === "STALE_OBSERVATION");
    await expect(
      session.count({ side: "base", observationId: observation.id, locator: button }),
    ).resolves.toEqual({ count: 1, stateVersion: 0 });

    await session.click({ side: "base", observationId: observation.id, locator: button });
    expect(base.calls.slice(-2)).toEqual(["count", "click"]);
    await expect(
      session.click({ side: "base", observationId: observation.id, locator: button }),
    ).rejects.toSatisfy((error: unknown) => errorCode(error) === "STALE_OBSERVATION");

    const ambiguousObservation = await session.observe({ side: "base" });
    base.matchCount = 2;
    const clicksBefore = base.calls.filter((call) => call === "click").length;
    await expect(
      session.click({ side: "base", observationId: ambiguousObservation.id, locator: button }),
    ).rejects.toSatisfy((error: unknown) => errorCode(error) === "LOCATOR_NOT_UNIQUE");
    expect(base.calls.filter((call) => call === "click")).toHaveLength(clicksBefore);
    await expect(
      session.count({ side: "base", observationId: ambiguousObservation.id, locator: button }),
    ).rejects.toSatisfy((error: unknown) => errorCode(error) === "STALE_OBSERVATION");
  });

  it("re-resolves and counts exactly one immediately before click, fill, select, and press", async () => {
    const { session, runtime } = await sessionFixture();
    const base = runtime.latest("base");

    const clicked = await session.observe({ side: "base" });
    await session.click({ side: "base", observationId: clicked.id, locator: button });
    const filled = await session.observe({ side: "base" });
    await session.fill({
      side: "base",
      observationId: filled.id,
      locator: button,
      value: { kind: "literal", value: "hello" },
    });
    const selected = await session.observe({ side: "base" });
    await session.select({
      side: "base",
      observationId: selected.id,
      locator: button,
      option: { kind: "label", label: "One" },
    });
    const pressed = await session.observe({ side: "base" });
    await session.press({
      side: "base",
      observationId: pressed.id,
      locator: button,
      key: "Enter",
    });

    expect(
      base.calls.filter((call) => ["count", "click", "fill", "select", "press"].includes(call)),
    ).toEqual(["count", "click", "count", "fill", "count", "select", "count", "press"]);
  });
});

describe("LiveBrowserSession origin and side isolation", () => {
  it("accepts only relative same-origin navigation and rejects a cross-origin redirect", async () => {
    const { session, runtime } = await sessionFixture();
    await expect(
      session.navigate({ side: "base", path: "/settings?tab=profile", waitUntil: "load" }),
    ).resolves.toMatchObject({ path: "/settings?tab=profile" });

    runtime.latest("base").redirectUrl = "https://attacker.example/phish";
    await expect(session.navigate({ side: "base", path: "/redirect" })).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === "SAME_ORIGIN_REQUIRED",
    );
    await expect(
      session.navigate({ side: "head", path: "https://attacker.example/phish" }),
    ).rejects.toSatisfy((error: unknown) => errorCode(error) === "INVALID_INPUT");
  });

  it("resets only the requested context and matches captured checkpoint names across sides", async () => {
    const { session, runtime } = await sessionFixture();
    const originalBase = runtime.latest("base");
    const originalHead = runtime.latest("head");
    await session.navigate({ side: "base", path: "/changed" });
    await session.checkpoint({ side: "base", name: "account-ready" });
    await session.checkpoint({ side: "head", name: "account-ready" });

    const reset = await session.reset({ side: "base" });
    expect(reset.path).toBe("/");
    expect(originalBase.closed).toBe(true);
    expect(originalHead.closed).toBe(false);
    expect(runtime.all("base")).toHaveLength(2);
    expect(runtime.all("head")).toHaveLength(1);
    expect(session.evidence().matchedCheckpointNames).toEqual(["account-ready"]);
  });
});

describe("LiveBrowserSession secrets and evidence", () => {
  it("uses approved named secrets internally while redacting observations, events, and ledger output", async () => {
    const secret = "swordfish-secret-value";
    const { session, runtime } = await sessionFixture({ secrets: { TEST_PASSWORD: secret } });
    const base = runtime.latest("base");
    base.pageTitle = `Welcome ${secret}`;
    base.snapshot = `- textbox "Password ${secret}"`;
    const observation = await session.observe({ side: "base" });
    expect(observation.title).not.toContain(secret);
    expect(observation.snapshot).not.toContain(secret);
    const renderedSecretCheckpoint = await session.checkpoint({
      side: "base",
      name: "rendered-secret",
    });
    expect(renderedSecretCheckpoint).toMatchObject({
      captured: false,
      side: "base",
      name: "rendered-secret",
    });
    expect(base.calls).not.toContain("screenshot");

    runtime.emit("base", {
      kind: "console",
      level: "error",
      message: `failed with ${secret}`,
      url: `${origins.base}/login?token=${secret}`,
    });
    const observedForFill = await session.observe({ side: "base" });
    await session.fill({
      side: "base",
      observationId: observedForFill.id,
      locator: button,
      value: { kind: "secret", name: "TEST_PASSWORD" },
    });
    expect(base.filledValues).toEqual([secret]);

    const checkpoint = await session.checkpoint({ side: "base", name: "after-login" });
    expect(checkpoint).toMatchObject({ captured: false, side: "base", name: "after-login" });
    expect(base.calls).not.toContain("screenshot");
    const events = await session.events({ side: "base" });
    const serialized = JSON.stringify({ observation, events, evidence: session.evidence() });
    expect(serialized).not.toContain(secret);
    expect(serialized).toContain("[REDACTED]");

    const unapprovedObservation = await session.observe({ side: "head" });
    await expect(
      session.fill({
        side: "head",
        observationId: unapprovedObservation.id,
        locator: button,
        value: { kind: "secret", name: "NOT_APPROVED" },
      }),
    ).rejects.toSatisfy((error: unknown) => errorCode(error) === "SECRET_NOT_APPROVED");
    expect(session.evidence().ledger.at(-1)).toMatchObject({
      tool: "browser_fill",
      outcome: "error",
      errorCode: "SECRET_NOT_APPROVED",
    });

    await session.reset({ side: "base" });
    const cleanContextCheckpoint = await session.checkpoint({
      side: "base",
      name: "after-secret-reset",
    });
    expect(cleanContextCheckpoint.captured).toBe(true);
    const resetBase = runtime.latest("base");

    const sealed = await session.seal();
    expect(sealed.recordings).toEqual([
      expect.objectContaining({ side: "base", captured: false }),
      expect.objectContaining({ side: "head", captured: true, mediaType: "video/webm" }),
    ]);
    expect(sealed.recordings[0]).not.toHaveProperty("artifactId");
    expect(sealed.recordings[0]).not.toHaveProperty("digest");
    expect(sealed.recordings[0]).not.toHaveProperty("byteSize");
    expect(sealed.recordings[0]).not.toHaveProperty("mediaType");
    expect(base.recordingCaptureRequests).toEqual([false]);
    expect(resetBase.recordingCaptureRequests).toEqual([false]);
  });

  it("records assertions and bounded cursor events in monotonic evidence order", async () => {
    const { session, runtime } = await sessionFixture({ budgets: { maxEventsPerRead: 1 } });
    runtime.emit("head", { kind: "console", level: "info", message: "first" });
    runtime.emit("head", { kind: "page_error", level: "error", message: "second" });

    const first = await session.events({ side: "head" });
    expect(first.events.map((event) => event.message)).toEqual(["first"]);
    expect(first.hasMore).toBe(true);
    const second = await session.events({ side: "head", cursor: first.cursor });
    expect(second.events.map((event) => event.message)).toEqual(["second"]);
    expect(second.hasMore).toBe(false);
    await expect(session.events({ side: "base", cursor: first.cursor })).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === "INVALID_CURSOR",
    );

    runtime.latest("head").url = `${origins.head}/done`;
    await expect(
      session.assert({
        side: "head",
        name: "saved-visible",
        assertion: { kind: "visible", target: button },
      }),
    ).resolves.toMatchObject({ passed: true, actual: "visible" });
    await expect(
      session.assert({
        side: "head",
        name: "saved-text",
        assertion: { kind: "text", target: button, includes: "Saved" },
      }),
    ).resolves.toMatchObject({ passed: true });
    await expect(
      session.assert({
        side: "head",
        name: "done-url",
        assertion: { kind: "url", includes: "/done" },
      }),
    ).resolves.toMatchObject({ passed: true, actual: "/done" });

    const evidence = session.evidence();
    expect(
      evidence.ledger
        .map(({ sequence }) => sequence)
        .every((value, index, values) => index === 0 || value > (values[index - 1] ?? 0)),
    ).toBe(true);
    expect(
      evidence.ledger.every(
        ({ startedAt, completedAt }) => Date.parse(completedAt) > Date.parse(startedAt),
      ),
    ).toBe(true);
    expect(evidence.assertions.map(({ sequence }) => sequence)).toEqual([1, 2, 3]);
    expect(evidence.assertions.map(({ name }) => name)).toEqual([
      "saved-visible",
      "saved-text",
      "done-url",
    ]);
  });

  it("pairs assertions by a unique stable name across base and head", async () => {
    const { session } = await sessionFixture();
    await session.assert({
      side: "base",
      name: "primary-action-visible",
      assertion: { kind: "visible", target: button },
    });
    await session.assert({
      side: "head",
      name: "primary-action-visible",
      assertion: { kind: "visible", target: button },
    });

    expect(session.evidence().matchedAssertionNames).toEqual(["primary-action-visible"]);
    await expect(
      session.assert({
        side: "head",
        name: "primary-action-visible",
        assertion: { kind: "visible", target: button },
      }),
    ).rejects.toSatisfy((error: unknown) => errorCode(error) === "INVALID_INPUT");
  });
});

describe("LiveBrowserSession budgets and lifecycle", () => {
  it("enforces the action ceiling and the wall-clock deadline server-side", async () => {
    const actionFixture = await sessionFixture({ budgets: { maxActions: 1 } });
    await actionFixture.session.navigate({ side: "base", path: "/one" });
    await expect(actionFixture.session.reset({ side: "head" })).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === "ACTION_BUDGET_EXHAUSTED",
    );
    expect(actionFixture.session.status()).toMatchObject({ actionsUsed: 1, actionsRemaining: 0 });

    let nowMs = Date.parse("2026-08-08T00:00:00.000Z");
    const timeFixture = await sessionFixture({
      budgets: { maxDurationMs: 10 },
      now: () => new Date(nowMs),
    });
    await timeFixture.session.observe({ side: "base" });
    nowMs += 11;
    await expect(timeFixture.session.observe({ side: "base" })).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === "TIME_BUDGET_EXHAUSTED",
    );
    expect(timeFixture.session.status().state).toBe("timed_out");
    const sealed = await timeFixture.session.seal();
    expect(sealed.status.state).toBe("timed_out");
  });

  it("times out a bounded tool and cancels an active tool before sealing exactly once", async () => {
    const timeoutFixture = await sessionFixture({ budgets: { toolTimeoutMs: 10 } });
    timeoutFixture.runtime.latest("base").hangSnapshot = true;
    await expect(timeoutFixture.session.observe({ side: "base" })).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === "TOOL_TIMEOUT",
    );

    const cancellationFixture = await sessionFixture();
    const controller = cancellationFixture.runtime.latest("head");
    controller.hangSnapshot = true;
    const observing = cancellationFixture.session.observe({ side: "head" });
    await controller.snapshotEntered.promise;
    const cancellation = cancellationFixture.session.cancel();
    await expect(observing).rejects.toSatisfy((error: unknown) => errorCode(error) === "CANCELLED");
    const cancelled = await cancellation;
    expect(cancelled).toMatchObject({
      status: { state: "cancelled" },
      recordings: [
        { side: "base", captured: true, mediaType: "video/webm" },
        { side: "head", captured: true, mediaType: "video/webm" },
      ],
    });
    await cancellationFixture.session.cancel();
    expect(cancellationFixture.runtime.closeCount).toBe(1);
    expect(cancellationFixture.runtime.latest("base").recordingCaptureRequests).toEqual([true]);
    expect(cancellationFixture.runtime.latest("head").recordingCaptureRequests).toEqual([true]);
    expect(
      cancellationFixture.session.evidence().ledger.filter(({ tool }) => tool === "finish_review"),
    ).toHaveLength(1);
    await expect(
      cancellationFixture.session.navigate({ side: "base", path: "/after-cancel" }),
    ).rejects.toSatisfy((error: unknown) => errorCode(error) === "CANCELLED");
  });

  it("gates exact checkpoint bytes until an idempotent seal", async () => {
    const { session, runtime } = await sessionFixture();
    const checkpoint = await session.checkpoint({ side: "base", name: "home-ready" });
    expect(checkpoint.captured).toBe(true);
    if (!checkpoint.artifactId) throw new Error("Captured checkpoint did not have an artifact ID.");
    const artifactId = checkpoint.artifactId;
    expect(() => session.artifact(artifactId)).toThrowError(LiveBrowserError);

    const firstSeal = await session.seal();
    const secondSeal = await session.seal();
    expect(firstSeal.status.state).toBe("finished");
    expect(secondSeal.status.state).toBe("finished");
    expect(runtime.closeCount).toBe(1);
    expect(session.artifact(artifactId)).toEqual(runtime.all("base")[0]?.screenshotBytes);
    expect(() => session.artifact("artifact_not-in-manifest")).toThrowError(LiveBrowserError);
    expect(session.evidence().ledger.filter(({ tool }) => tool === "finish_review")).toHaveLength(
      1,
    );
  });

  it("captures hash-addressed base and head WebM bytes only after seal", async () => {
    const { session, runtime } = await sessionFixture();
    const baseController = runtime.latest("base");
    baseController.recordingGate = voidDeferred();
    baseController.recordingEntered = voidDeferred();
    const baseBytes = baseController.recordingBytes;
    const baseDigest = sha256(baseBytes);
    const predictedBaseArtifactId = `artifact:${sha256(`base\0recording\0${baseDigest}`)}`;

    expect(session.evidence().recordings).toEqual([]);
    expect(() => session.artifact(predictedBaseArtifactId)).toThrowError(LiveBrowserError);

    const sealing = session.seal();
    await baseController.recordingEntered.promise;
    expect(() => session.artifact(predictedBaseArtifactId)).toThrowError(LiveBrowserError);
    baseController.recordingGate.resolve();
    const firstSeal = await sealing;
    const secondSeal = await session.seal();
    expect(liveBrowserEvidenceSchema.parse(firstSeal).recordings).toHaveLength(2);
    expect(secondSeal.recordings).toEqual(firstSeal.recordings);
    expect(firstSeal.recordings).toHaveLength(2);
    expect(firstSeal.recordings[0]).toMatchObject({
      artifactId: predictedBaseArtifactId,
      side: "base",
      captured: true,
      digest: baseDigest,
      byteSize: baseBytes.byteLength,
      mediaType: "video/webm",
    });
    expect(firstSeal.recordings[1]).toMatchObject({
      side: "head",
      captured: true,
      digest: sha256(runtime.latest("head").recordingBytes),
      byteSize: runtime.latest("head").recordingBytes.byteLength,
      mediaType: "video/webm",
    });
    expect(session.artifact(predictedBaseArtifactId)).toEqual(baseBytes);
    const returned = session.artifact(predictedBaseArtifactId);
    returned[0] = 0;
    expect(session.artifact(predictedBaseArtifactId)).toEqual(baseBytes);
    expect(runtime.latest("base").recordingCaptureRequests).toEqual([true]);
    expect(runtime.latest("head").recordingCaptureRequests).toEqual([true]);
  });

  it("serializes concurrent calls across both browser sides", async () => {
    const { session, runtime } = await sessionFixture();
    const base = runtime.latest("base");
    base.clickGate = voidDeferred();
    base.clickEntered = voidDeferred();
    const observation = await session.observe({ side: "base" });

    const clicking = session.click({
      side: "base",
      observationId: observation.id,
      locator: button,
    });
    await base.clickEntered.promise;
    const navigating = session.navigate({ side: "head", path: "/queued" });
    await Promise.resolve();
    expect(runtime.timeline).not.toContain("head:navigate");

    base.clickGate.resolve();
    await clicking;
    await navigating;
    expect(runtime.timeline.indexOf("head:navigate")).toBeGreaterThan(
      runtime.timeline.indexOf("base:click"),
    );
  });
});
