import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { chromium, type Browser, type Locator, type Page } from "playwright";

import {
  redactText,
  sideRunResultSchema,
  type AssertionResult,
  type BrowserEvent,
  type SideRunResult,
  type TestLocator,
  type TestPlan,
  type TestStep,
} from "@trialrun/domain";

import type { ReviewSide } from "./types";

export interface BrowserRunInput {
  readonly side: ReviewSide;
  readonly baseUrl: string;
  readonly plan: TestPlan;
  readonly secrets: Readonly<Record<string, string>>;
  readonly artifactDirectory: string;
  readonly signal?: AbortSignal;
}

interface ActionObservation {
  readonly step: number;
  readonly action: TestStep["action"];
  readonly observedAt: string;
  readonly accessibilitySnapshot: string;
  readonly urlBefore: string;
  urlAfter?: string;
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

async function requireUnique(page: Page, locator: TestLocator): Promise<Locator> {
  const target = locatorFor(page, locator);
  const count = await target.count();
  if (count !== 1) {
    throw new Error(`Semantic locator resolved to ${count} elements; exactly one is required.`);
  }
  return target;
}

function expandVariables(path: string, variables: ReadonlyMap<string, string>): string {
  return path.replace(/\{\{([a-z][a-zA-Z0-9]{0,49})\}\}/g, (_match, name: string) => {
    const value = variables.get(name);
    if (!value) throw new Error(`Plan variable ${name} was not captured.`);
    return encodeURIComponent(value);
  });
}

function jsonPathValue(value: unknown, path: string): string {
  const parts = path.slice(2).split(".");
  let current: unknown = value;
  for (const part of parts) {
    if (typeof current !== "object" || current === null || !(part in current)) {
      throw new Error(`Response did not contain ${path}.`);
    }
    current = current[part as keyof typeof current];
  }
  if (typeof current !== "string" && typeof current !== "number") {
    throw new Error(`${path} was not a string or number.`);
  }
  return String(current);
}

function actionLabel(step: TestStep): string {
  switch (step.action) {
    case "goto":
      return `Open ${step.path}`;
    case "click":
      return step.response
        ? `${step.response.method} ${step.response.path} returns ${step.response.expectedStatus}`
        : "Click the requested control";
    case "fill":
      return "Fill the requested field";
    case "select":
      return "Select the requested option";
    case "press":
      return `Press ${step.key}`;
    case "assert":
      return `Assert ${step.assertion.kind}`;
    case "request":
      return `${step.method} ${step.path} returns ${step.expectedStatus}`;
    case "checkpoint":
      return `Capture ${step.name}`;
  }
}

function assertion(
  step: number,
  label: string,
  passed: boolean,
  expected: string,
  actual: string,
): AssertionResult {
  return { step, label, passed, expected, actual };
}

export class BrowserExecutor {
  async run(input: BrowserRunInput, browser?: Browser): Promise<SideRunResult> {
    await mkdir(input.artifactDirectory, { recursive: true });
    const ownsBrowser = !browser;
    const activeBrowser = browser ?? (await chromium.launch({ headless: true }));
    const redactionValues = Object.values(input.secrets).filter((value) => value.length > 0);
    const artifactPolicy = redactionValues.length === 0 ? "full" : "secret_safe";
    const videoDirectory = join(input.artifactDirectory, "video");
    if (artifactPolicy === "full") await mkdir(videoDirectory, { recursive: true });
    const context = await activeBrowser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "en-US",
      timezoneId: "UTC",
      colorScheme: "dark",
      reducedMotion: "reduce",
      serviceWorkers: "block",
      ...(artifactPolicy === "full"
        ? { recordVideo: { dir: videoDirectory, size: { width: 1280, height: 800 } } }
        : {}),
    });
    if (artifactPolicy === "full") {
      await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    }
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.setDefaultNavigationTimeout(20_000);

    const events: BrowserEvent[] = [];
    const recordEvent = (event: BrowserEvent): void => {
      events.push({ ...event, message: redactText(event.message, redactionValues) });
    };
    page.on("console", (message) => {
      const type = message.type();
      recordEvent({
        at: new Date().toISOString(),
        kind: "console",
        level: type === "error" ? "error" : type === "warning" ? "warning" : "info",
        message: message.text(),
      });
    });
    page.on("pageerror", (error) =>
      recordEvent({
        at: new Date().toISOString(),
        kind: "page_error",
        level: "error",
        message: error.message,
      }),
    );
    page.on("response", (response) => {
      if (response.status() >= 400) {
        recordEvent({
          at: new Date().toISOString(),
          kind: "http_error",
          level: "error",
          message: `${response.request().method()} returned HTTP ${response.status()}`,
          url: redactText(response.url(), redactionValues),
          status: response.status(),
        });
      }
    });
    page.on("requestfailed", (request) =>
      recordEvent({
        at: new Date().toISOString(),
        kind: "request_failed",
        level: "error",
        message: request.failure()?.errorText ?? "Request failed",
        url: redactText(request.url(), redactionValues),
      }),
    );

    const startedAt = new Date().toISOString();
    const assertions: AssertionResult[] = [];
    const checkpoints: Array<{ name: string; artifactPath: string }> = [];
    const variables = new Map<string, string>();
    const tracePath =
      artifactPolicy === "full" ? join(input.artifactDirectory, `${input.side}-trace.zip`) : undefined;
    const observationsPath =
      artifactPolicy === "full"
        ? join(input.artifactDirectory, `${input.side}-observations.json`)
        : undefined;
    const observations: ActionObservation[] = [];
    let videoPath: string | undefined;
    const cleanupErrors: Error[] = [];

    try {
      stepLoop: for (const [stepIndex, step] of input.plan.steps.entries()) {
        try {
          input.signal?.throwIfAborted();
          const needsCurrentDom = ["click", "fill", "select", "press", "assert"].includes(
            step.action,
          );
          const accessibilitySnapshot = needsCurrentDom
            ? redactText(
                await page.locator("body").ariaSnapshot({ timeout: 5_000 }),
                redactionValues,
              )
            : null;
          const observation: ActionObservation | null =
            artifactPolicy === "full" && accessibilitySnapshot !== null
            ? {
                step: stepIndex,
                action: step.action,
                observedAt: new Date().toISOString(),
                accessibilitySnapshot,
                urlBefore: redactText(page.url(), redactionValues),
              }
            : null;
          if (observation) observations.push(observation);
          switch (step.action) {
            case "goto": {
              const url = new URL(step.path, input.baseUrl);
              const baseOrigin = new URL(input.baseUrl).origin;
              if (url.origin !== baseOrigin) throw new Error("Navigation escaped the assigned application origin.");
              const response = await page.goto(url.href, { waitUntil: step.waitUntil });
              const actualOrigin = new URL(page.url()).origin;
              const status = response?.status() ?? 0;
              assertions.push(
                assertion(
                  stepIndex,
                  actionLabel(step),
                  status > 0 && status < 400 && actualOrigin === baseOrigin,
                  `HTTP < 400 on ${baseOrigin}`,
                  `HTTP ${status} on ${actualOrigin}`,
                ),
              );
              break;
            }
            case "click": {
              const target = await requireUnique(page, step.target);
              if (step.response) {
                const expected = step.response;
                const expectedUrl = new URL(expandVariables(expected.path, variables), input.baseUrl);
                const applicationOrigin = new URL(input.baseUrl).origin;
                const [response] = await Promise.all([
                  page.waitForResponse(
                    (candidate) => {
                      const candidateUrl = new URL(candidate.url());
                      return (
                        candidateUrl.origin === applicationOrigin &&
                        candidateUrl.pathname === expectedUrl.pathname &&
                        candidateUrl.search === expectedUrl.search &&
                        candidate.request().method() === expected.method &&
                        candidate.request().frame() === page.mainFrame()
                      );
                    },
                  ),
                  target.click(),
                ]);
                const passed = response.status() === expected.expectedStatus;
                if (expected.captureJson && response.status() < 400) {
                  const body: unknown = await response.json();
                  variables.set(
                    expected.captureJson.variable,
                    jsonPathValue(body, expected.captureJson.jsonPath),
                  );
                }
                assertions.push(
                  assertion(
                    stepIndex,
                    actionLabel(step),
                    passed,
                    `HTTP ${expected.expectedStatus}`,
                    `HTTP ${response.status()}`,
                  ),
                );
              } else {
                await target.click();
                assertions.push(
                  assertion(stepIndex, actionLabel(step), true, "one semantic target clicked", "clicked"),
                );
              }
              if (observation) observation.urlAfter = redactText(page.url(), redactionValues);
              break;
            }
            case "fill": {
              const secretName = step.value.kind === "secret" ? step.value.name : null;
              const value =
                step.value.kind === "literal"
                  ? step.value.value
                  : input.secrets[step.value.name];
              if (value === undefined) {
                throw new Error(`Required test secret ${secretName ?? "unknown"} was not supplied.`);
              }
              const target = await requireUnique(page, step.target);
              await target.fill(value);
              const valueMatches = (await target.inputValue()) === value;
              assertions.push(
                assertion(
                  stepIndex,
                  actionLabel(step),
                  valueMatches,
                  "field contains the supplied value",
                  valueMatches ? "value matched" : "value did not match",
                ),
              );
              if (observation) observation.urlAfter = redactText(page.url(), redactionValues);
              break;
            }
            case "select": {
              const target = await requireUnique(page, step.target);
              const selected = await target.selectOption(
                step.option.kind === "value"
                  ? { value: step.option.value }
                  : step.option.kind === "label"
                    ? { label: step.option.label }
                    : { index: step.option.index },
              );
              const passed = selected.length === 1;
              assertions.push(
                assertion(
                  stepIndex,
                  actionLabel(step),
                  passed,
                  "exactly one option selected",
                  `${selected.length} options selected`,
                ),
              );
              if (observation) observation.urlAfter = redactText(page.url(), redactionValues);
              break;
            }
            case "press": {
              const target = await requireUnique(page, step.target);
              await target.press(step.key);
              assertions.push(
                assertion(stepIndex, actionLabel(step), true, `${step.key} accepted`, `${step.key} accepted`),
              );
              if (observation) observation.urlAfter = redactText(page.url(), redactionValues);
              break;
            }
            case "assert": {
              const { assertion: expected } = step;
              if (expected.kind === "url") {
                const actual = page.url();
                assertions.push(
                  assertion(
                    stepIndex,
                    actionLabel(step),
                    actual.includes(expected.includes),
                    `URL containing ${expected.includes}`,
                    actual,
                  ),
                );
              } else {
                const rawTarget = locatorFor(page, expected.target);
                if (expected.kind === "visible" || expected.kind === "hidden") {
                  const count = await rawTarget.count();
                  if (count > 1) {
                    throw new Error(`Assertion locator resolved to ${count} elements; at most one is allowed.`);
                  }
                  const visible = count === 1 ? await rawTarget.isVisible() : false;
                  const desired = expected.kind === "visible";
                  assertions.push(
                    assertion(
                      stepIndex,
                      actionLabel(step),
                      visible === desired,
                      desired ? "visible" : "hidden",
                      visible ? "visible" : "hidden",
                    ),
                  );
                } else {
                  const target = await requireUnique(page, expected.target);
                  const actual = (await target.textContent()) ?? "";
                  assertions.push(
                    assertion(
                      stepIndex,
                      actionLabel(step),
                      actual.includes(expected.includes),
                      `text containing ${expected.includes}`,
                      actual.slice(0, 2_000),
                    ),
                  );
                }
              }
              if (observation) observation.urlAfter = redactText(page.url(), redactionValues);
              break;
            }
            case "request": {
              const path = expandVariables(step.path, variables);
              const requestUrl = new URL(path, input.baseUrl);
              if (requestUrl.origin !== new URL(input.baseUrl).origin) {
                throw new Error("API request escaped the assigned application origin.");
              }
              const response = await context.request.fetch(requestUrl.href, {
                method: step.method,
                maxRedirects: 0,
              });
              if (response.status() >= 400) {
                recordEvent({
                  at: new Date().toISOString(),
                  kind: "http_error",
                  level: "error",
                  message: `${step.method} returned HTTP ${response.status()}`,
                  url: redactText(requestUrl.href, redactionValues),
                  status: response.status(),
                });
              }
              assertions.push(
                assertion(
                  stepIndex,
                  actionLabel(step),
                  response.status() === step.expectedStatus,
                  `HTTP ${step.expectedStatus}`,
                  `HTTP ${response.status()}`,
                ),
              );
              break;
            }
            case "checkpoint": {
              if (artifactPolicy === "full") {
                const artifactPath = join(input.artifactDirectory, `${input.side}-${step.name}.png`);
                await page.screenshot({ path: artifactPath, fullPage: true, animations: "disabled" });
                checkpoints.push({ name: step.name, artifactPath });
                assertions.push(
                  assertion(stepIndex, actionLabel(step), true, "screenshot captured", "screenshot captured"),
                );
              } else {
                assertions.push(
                  assertion(
                    stepIndex,
                    actionLabel(step),
                    true,
                    "visual capture disabled by secret-safe policy",
                    "visual capture disabled by secret-safe policy",
                  ),
                );
              }
              break;
            }
          }
          if (assertions.at(-1)?.passed === false) break stepLoop;
        } catch (error) {
          const message = redactText(error instanceof Error ? error.message : String(error), redactionValues);
          assertions.push(
            assertion(stepIndex, actionLabel(step), false, "step completes", message.slice(0, 2_000)),
          );
          break stepLoop;
        }
      }
    } finally {
      const attempt = async (cleanup: () => Promise<void>): Promise<void> => {
        try {
          await cleanup();
        } catch (error) {
          cleanupErrors.push(error instanceof Error ? error : new Error(String(error)));
        }
      };
      if (observationsPath) {
        await attempt(() =>
          writeFile(observationsPath, JSON.stringify(observations, null, 2), {
            encoding: "utf8",
            mode: 0o600,
          }),
        );
      }
      if (tracePath) await attempt(() => context.tracing.stop({ path: tracePath }));
      const video = artifactPolicy === "full" ? page.video() : null;
      await attempt(() => context.close());
      if (video) {
        const destination = join(input.artifactDirectory, `${input.side}-run.webm`);
        videoPath = destination;
        await attempt(() => video.saveAs(destination));
      }
      if (ownsBrowser) await attempt(() => activeBrowser.close());
    }
    const cleanupFailure = cleanupErrors[0];
    if (cleanupFailure) throw cleanupFailure;

    const safeAssertions = assertions.map((result) => ({
      ...result,
      label: redactText(result.label, redactionValues),
      expected: redactText(result.expected, redactionValues),
      actual: redactText(result.actual, redactionValues),
    }));
    return sideRunResultSchema.parse({
      side: input.side,
      baseUrl: input.baseUrl,
      startedAt,
      completedAt: new Date().toISOString(),
      artifactPolicy,
      assertions: safeAssertions,
      browserEvents: events,
      checkpoints,
      ...(tracePath ? { tracePath } : {}),
      ...(videoPath ? { videoPath } : {}),
      ...(observationsPath ? { observationsPath } : {}),
    });
  }

  async runPair(
    input: Omit<BrowserRunInput, "side" | "baseUrl" | "artifactDirectory"> & {
      readonly baseUrl: string;
      readonly headUrl: string;
      readonly artifactRoot: string;
    },
  ): Promise<readonly [SideRunResult, SideRunResult]> {
    const browser = await chromium.launch({ headless: true });
    const closeOnAbort = (): void => {
      void browser.close();
    };
    input.signal?.addEventListener("abort", closeOnAbort, { once: true });
    try {
      input.signal?.throwIfAborted();
      const base = await this.run(
        {
          side: "base",
          baseUrl: input.baseUrl,
          plan: input.plan,
          secrets: input.secrets,
          artifactDirectory: join(input.artifactRoot, "base"),
          ...(input.signal ? { signal: input.signal } : {}),
        },
        browser,
      );
      input.signal?.throwIfAborted();
      const head = await this.run(
        {
          side: "head",
          baseUrl: input.headUrl,
          plan: input.plan,
          secrets: input.secrets,
          artifactDirectory: join(input.artifactRoot, "head"),
          ...(input.signal ? { signal: input.signal } : {}),
        },
        browser,
      );
      input.signal?.throwIfAborted();
      return [base, head];
    } finally {
      input.signal?.removeEventListener("abort", closeOnAbort);
      await browser.close();
    }
  }
}
