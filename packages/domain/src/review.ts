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
  z.object({
    kind: z.literal("text"),
    text: z.string().min(1).max(240),
    exact: z.boolean().default(true),
  }),
  z.object({ kind: z.literal("test_id"), value: z.string().min(1).max(120) }),
]);

export type TestLocator = z.infer<typeof testLocatorSchema>;

export const testInputValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("literal"), value: z.string().max(500) }),
  z.object({ kind: z.literal("secret"), name: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/) }),
]);

export type TestInputValue = z.infer<typeof testInputValueSchema>;

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

export type TestAssertion = z.infer<typeof testAssertionSchema>;

export const testSelectOptionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("value"), value: z.string().max(300) }),
  z.object({ kind: z.literal("label"), label: z.string().max(300) }),
  z.object({ kind: z.literal("index"), index: z.number().int().nonnegative().max(1_000) }),
]);

export type TestSelectOption = z.infer<typeof testSelectOptionSchema>;

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

export type TestPressKey = z.infer<typeof testPressKeySchema>;

export const testNavigationWaitUntilSchema = z.enum(["domcontentloaded", "load", "networkidle"]);

export type TestNavigationWaitUntil = z.infer<typeof testNavigationWaitUntilSchema>;

export const browserEventSchema = z.object({
  at: z.string().datetime(),
  kind: z.enum(["console", "page_error", "http_error", "request_failed"]),
  level: z.enum(["debug", "info", "warning", "error"]),
  message: z.string().max(8_000),
  url: z.string().max(2_000).optional(),
  status: z.number().int().min(100).max(599).optional(),
});

export type BrowserEvent = z.infer<typeof browserEventSchema>;

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
