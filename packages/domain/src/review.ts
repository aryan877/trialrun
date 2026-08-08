import { z } from "zod";

export const reviewStatuses = [
  "queued",
  "provisioning",
  "building",
  "planning",
  "running",
  "comparing",
  "publishing",
  "tearing_down",
  "completed",
  "inconclusive",
  "cancelled",
] as const;

export const reviewStatusSchema = z.enum(reviewStatuses);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

export const reviewVerdicts = ["pass", "fail", "inconclusive"] as const;
export const reviewVerdictSchema = z.enum(reviewVerdicts);
export type ReviewVerdict = z.infer<typeof reviewVerdictSchema>;

export const executionProviders = ["local", "zerops"] as const;
export const executionProviderSchema = z.enum(executionProviders);
export type ExecutionProviderName = z.infer<typeof executionProviderSchema>;

export const testLocatorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("role"),
    role: z.enum([
      "button",
      "checkbox",
      "dialog",
      "heading",
      "link",
      "menuitem",
      "radio",
      "tab",
      "textbox",
    ]),
    name: z.string().min(1).max(160),
    exact: z.boolean().default(true),
  }),
  z.object({ kind: z.literal("label"), text: z.string().min(1).max(160) }),
  z.object({ kind: z.literal("text"), text: z.string().min(1).max(240), exact: z.boolean().default(true) }),
  z.object({ kind: z.literal("test_id"), value: z.string().min(1).max(120) }),
]);

export type TestLocator = z.infer<typeof testLocatorSchema>;

export const testInputValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("literal"), value: z.string().max(500) }),
  z.object({ kind: z.literal("secret"), name: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/) }),
]);

const responseExpectationSchema = z.object({
  path: z.string().regex(/^\/(?!\/).*/).max(300),
  method: z.enum(["DELETE", "GET", "PATCH", "POST", "PUT"]),
  expectedStatus: z.number().int().min(100).max(599),
  captureJson: z
    .object({
      jsonPath: z.string().regex(/^\$\.[a-zA-Z0-9_.-]+$/),
      variable: z.string().regex(/^[a-z][a-zA-Z0-9]{0,49}$/),
    })
    .optional(),
});

export const testAssertionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("visible"), target: testLocatorSchema }),
  z.object({ kind: z.literal("hidden"), target: testLocatorSchema }),
  z.object({
    kind: z.literal("text"),
    target: testLocatorSchema,
    includes: z.string().min(1).max(500),
  }),
  z.object({ kind: z.literal("url"), includes: z.string().min(1).max(300) }),
]);

export const testSelectOptionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("value"), value: z.string().max(300) }),
  z.object({ kind: z.literal("label"), label: z.string().max(300) }),
  z.object({ kind: z.literal("index"), index: z.number().int().nonnegative().max(1_000) }),
]);

export const testPressKeySchema = z.enum([
  "Enter",
  "Escape",
  "Tab",
  "ArrowDown",
  "ArrowUp",
  "ArrowLeft",
  "ArrowRight",
  "Space",
]);

export const testNavigationWaitUntilSchema = z.enum(["domcontentloaded", "load", "networkidle"]);

export const testStepSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("goto"),
    path: z.string().regex(/^\/(?!\/).*/),
    waitUntil: testNavigationWaitUntilSchema.default("domcontentloaded"),
  }),
  z.object({
    action: z.literal("click"),
    target: testLocatorSchema,
    response: responseExpectationSchema.optional(),
  }),
  z.object({
    action: z.literal("fill"),
    target: testLocatorSchema,
    value: testInputValueSchema,
  }),
  z.object({
    action: z.literal("select"),
    target: testLocatorSchema,
    option: testSelectOptionSchema,
  }),
  z.object({
    action: z.literal("press"),
    target: testLocatorSchema,
    key: testPressKeySchema,
  }),
  z.object({ action: z.literal("assert"), assertion: testAssertionSchema }),
  z.object({
    action: z.literal("request"),
    method: z.enum(["DELETE", "GET", "PATCH", "POST", "PUT"]),
    path: z.string().regex(/^\/(?!\/).*/),
    expectedStatus: z.number().int().min(100).max(599),
  }),
  z.object({
    action: z.literal("checkpoint"),
    name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
  }),
]);

export type TestStep = z.infer<typeof testStepSchema>;

export const testPlanSchema = z
  .object({
    version: z.literal(1),
    title: z.string().min(1).max(120),
    rationale: z.string().min(1).max(1_000),
    requiredSecretNames: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/)).max(20),
    steps: z.array(testStepSchema).min(1).max(30),
  })
  .superRefine((plan, context) => {
    const requiredSecrets = new Set(plan.requiredSecretNames);
    if (requiredSecrets.size !== plan.requiredSecretNames.length) {
      context.addIssue({ code: "custom", path: ["requiredSecretNames"], message: "Secret names must be unique." });
    }
    const checkpointNames = plan.steps
      .filter((step) => step.action === "checkpoint")
      .map((step) => step.name);
    if (checkpointNames.length === 0) {
      context.addIssue({ code: "custom", path: ["steps"], message: "Every plan needs a checkpoint." });
    }
    if (new Set(checkpointNames).size !== checkpointNames.length) {
      context.addIssue({ code: "custom", path: ["steps"], message: "Checkpoint names must be unique." });
    }
    for (const [index, step] of plan.steps.entries()) {
      if (step.action === "fill" && step.value.kind === "secret" && !requiredSecrets.has(step.value.name)) {
        context.addIssue({
          code: "custom",
          path: ["steps", index, "value", "name"],
          message: "A secret fill must declare its name in requiredSecretNames.",
        });
      }
    }
  });

export type TestPlan = z.infer<typeof testPlanSchema>;

export const assertionResultSchema = z.object({
  step: z.number().int().nonnegative(),
  label: z.string().min(1).max(500),
  passed: z.boolean(),
  expected: z.string().max(1_000),
  actual: z.string().max(2_000),
});

export type AssertionResult = z.infer<typeof assertionResultSchema>;

export const browserEventSchema = z.object({
  at: z.string().datetime(),
  kind: z.enum(["console", "page_error", "http_error", "request_failed"]),
  level: z.enum(["debug", "info", "warning", "error"]),
  message: z.string().max(8_000),
  url: z.string().max(2_000).optional(),
  status: z.number().int().min(100).max(599).optional(),
});

export type BrowserEvent = z.infer<typeof browserEventSchema>;

export const sideRunResultSchema = z.object({
  side: z.enum(["base", "head"]),
  baseUrl: z.string().url(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  artifactPolicy: z.enum(["full", "secret_safe"]),
  assertions: z.array(assertionResultSchema).min(1),
  browserEvents: z.array(browserEventSchema),
  checkpoints: z.array(z.object({ name: z.string(), artifactPath: z.string() })),
  tracePath: z.string().optional(),
  videoPath: z.string().optional(),
  observationsPath: z.string().optional(),
});

export type SideRunResult = z.infer<typeof sideRunResultSchema>;

export interface ComparisonFinding {
  readonly severity: "blocking" | "warning";
  readonly kind: "behavioral_regression" | "declared_assertion";
  readonly title: string;
  readonly summary: string;
  readonly firstDivergentStep: number;
}

export interface ComparisonResult {
  readonly verdict: ReviewVerdict;
  readonly summary: string;
  readonly findings: readonly ComparisonFinding[];
}

const allowedTransitions: Readonly<Record<ReviewStatus, readonly ReviewStatus[]>> = {
  queued: ["provisioning", "inconclusive", "cancelled"],
  provisioning: ["building", "tearing_down", "inconclusive", "cancelled"],
  building: ["planning", "tearing_down", "inconclusive", "cancelled"],
  planning: ["running", "tearing_down", "inconclusive", "cancelled"],
  running: ["comparing", "tearing_down", "inconclusive", "cancelled"],
  comparing: ["publishing", "tearing_down", "inconclusive"],
  publishing: ["tearing_down", "inconclusive"],
  tearing_down: ["completed", "inconclusive", "cancelled"],
  completed: [],
  inconclusive: [],
  cancelled: [],
};

export function canTransitionReview(from: ReviewStatus, to: ReviewStatus): boolean {
  return allowedTransitions[from].includes(to);
}

export function compareRuns(base: SideRunResult, head: SideRunResult): ComparisonResult {
  const evidenceProblem = evidenceProblemFor(base, head);
  if (evidenceProblem) {
    return {
      verdict: "inconclusive",
      summary: evidenceProblem,
      findings: [],
    };
  }

  const baseFailure = base.assertions.find((assertion) => !assertion.passed);
  if (baseFailure) {
    return {
      verdict: "inconclusive",
      summary: `The base application failed step ${baseFailure.step + 1}; the PR cannot be judged fairly.`,
      findings: [],
    };
  }

  const headFailure = head.assertions.find((assertion) => !assertion.passed);
  if (headFailure) {
    const finding: ComparisonFinding = {
      severity: "blocking",
      kind: "behavioral_regression",
      title: headFailure.label,
      summary: `Base passed, but PR produced ${headFailure.actual} instead of ${headFailure.expected}.`,
      firstDivergentStep: headFailure.step,
    };
    return {
      verdict: "fail",
      summary: `One first reproducible behavioral divergence was found at step ${headFailure.step + 1}.`,
      findings: [finding],
    };
  }

  return {
    verdict: "pass",
    summary: "The PR satisfied every recorded assertion that passed on the base commit.",
    findings: [],
  };
}

function evidenceProblemFor(base: SideRunResult, head: SideRunResult): string | null {
  if (base.side !== "base" || head.side !== "head") {
    return "The comparison sides were mislabeled, so the PR cannot be judged safely.";
  }
  if (Date.parse(base.completedAt) <= Date.parse(base.startedAt)) {
    return "The base execution timestamps are invalid.";
  }
  if (Date.parse(head.completedAt) <= Date.parse(head.startedAt)) {
    return "The PR execution timestamps are invalid.";
  }
  if (base.artifactPolicy !== head.artifactPolicy) {
    return "Base and PR used different artifact privacy policies.";
  }
  if (base.assertions.length === 0 || head.assertions.length === 0) {
    return "Base or PR execution did not record any step evidence.";
  }

  for (const result of [base, head]) {
    for (const [index, assertion] of result.assertions.entries()) {
      if (assertion.step !== index) {
        return `${result.side === "base" ? "Base" : "PR"} step evidence is missing or out of order.`;
      }
    }
    if (result.artifactPolicy === "full") {
      if (!result.tracePath || !result.videoPath || !result.observationsPath) {
        return `${result.side === "base" ? "Base" : "PR"} is missing required full-mode browser evidence.`;
      }
    } else if (
      result.tracePath ||
      result.videoPath ||
      result.observationsPath ||
      result.checkpoints.length > 0
    ) {
      return `${result.side === "base" ? "Base" : "PR"} persisted visual evidence despite secret-safe mode.`;
    }
  }

  const comparableSteps = Math.min(base.assertions.length, head.assertions.length);
  for (let index = 0; index < comparableSteps; index += 1) {
    const baseStep = base.assertions[index];
    const headStep = head.assertions[index];
    if (!baseStep || !headStep || baseStep.label !== headStep.label) {
      return "Base and PR step evidence is not aligned.";
    }
  }

  const headFailure = head.assertions.find((assertion) => !assertion.passed);
  if (!headFailure && base.assertions.length !== head.assertions.length) {
    return "The PR execution ended without recording every base step.";
  }

  if (base.artifactPolicy === "full") {
    const baseCheckpoints = base.checkpoints.map(({ name }) => name);
    const headCheckpoints = head.checkpoints.map(({ name }) => name);
    const checkpointsAlign = headFailure
      ? headCheckpoints.every((name, index) => baseCheckpoints[index] === name)
      : baseCheckpoints.length > 0 && JSON.stringify(baseCheckpoints) === JSON.stringify(headCheckpoints);
    if (!checkpointsAlign) {
      return "Base and PR checkpoint evidence is not aligned.";
    }
  }
  return null;
}
