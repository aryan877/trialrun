import { browserEventSchema } from "@trialrun/domain";
import { z } from "zod";

import type { LiveBrowserEvidence } from "./live-browser";

export const liveBrowserErrorCodeSchema = z.enum([
  "ACTION_BUDGET_EXHAUSTED",
  "ARTIFACT_LIMIT",
  "CANCELLED",
  "INVALID_CURSOR",
  "INVALID_INPUT",
  "LOCATOR_NOT_UNIQUE",
  "SAME_ORIGIN_REQUIRED",
  "SECRET_NOT_APPROVED",
  "SESSION_SEALED",
  "STALE_OBSERVATION",
  "TIME_BUDGET_EXHAUSTED",
  "TOOL_TIMEOUT",
]);

const sideSchema = z.enum(["base", "head"]);
const evidenceIdSchema = z.string().min(1).max(160);
const timestampSchema = z.string().datetime({ offset: true });

export const liveBrowserStatusSchema = z.strictObject({
  state: z.enum(["active", "cancelled", "finished", "timed_out"]),
  actionsUsed: z.number().int().nonnegative().max(10_000),
  actionsRemaining: z.number().int().nonnegative().max(10_000),
  checkpointsRemaining: z.number().int().nonnegative().max(100),
  resetsRemaining: z.number().int().nonnegative().max(100),
  expiresAt: timestampSchema,
  stateVersions: z.strictObject({
    base: z.number().int().nonnegative().max(1_000_000),
    head: z.number().int().nonnegative().max(1_000_000),
  }),
});

const liveToolNameSchema = z.enum([
  "browser_assert",
  "browser_checkpoint",
  "browser_click",
  "browser_count",
  "browser_events",
  "browser_fill",
  "browser_navigate",
  "browser_observe",
  "browser_press",
  "browser_reset",
  "browser_select",
  "finish_review",
]);

const liveEvidenceEntrySchema = z.strictObject({
  id: evidenceIdSchema,
  sequence: z.number().int().positive().max(1_000_000),
  tool: liveToolNameSchema,
  side: sideSchema.optional(),
  stateVersion: z.number().int().nonnegative().max(1_000_000).optional(),
  observationId: evidenceIdSchema.optional(),
  input: z.record(z.string(), z.json()),
  startedAt: timestampSchema,
  completedAt: timestampSchema,
  outcome: z.enum(["success", "error"]),
  result: z.string().max(2_000),
  errorCode: liveBrowserErrorCodeSchema.optional(),
});

const liveObservationMetadataSchema = z.strictObject({
  id: evidenceIdSchema,
  side: sideSchema,
  path: z.string().max(2_000),
  title: z.string().max(512),
  snapshotTruncated: z.boolean(),
  viewport: z.strictObject({
    width: z.number().int().positive().max(20_000),
    height: z.number().int().positive().max(20_000),
  }),
  stateVersion: z.number().int().nonnegative().max(1_000_000),
  observedAt: timestampSchema,
});

const liveAssertionRecordSchema = z.strictObject({
  id: evidenceIdSchema,
  name: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(80),
  sequence: z.number().int().positive().max(1_000_000),
  side: sideSchema,
  stateVersion: z.number().int().nonnegative().max(1_000_000),
  path: z.string().max(2_000),
  kind: z.enum(["visible", "hidden", "text", "url"]),
  locatorFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  passed: z.boolean(),
  expected: z.string().max(1_000),
  actual: z.string().max(2_000),
  createdAt: timestampSchema,
});

const liveCheckpointRecordSchema = z
  .strictObject({
    artifactId: z.string().regex(/^artifact:[0-9a-f]{64}$/).optional(),
    name: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(80),
    side: sideSchema,
    stateVersion: z.number().int().nonnegative().max(1_000_000),
    path: z.string().max(2_000),
    captured: z.boolean(),
    digest: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    byteSize: z.number().int().positive().max(128 * 1_024 * 1_024).optional(),
    mediaType: z.literal("image/png").optional(),
    createdAt: timestampSchema,
  })
  .superRefine((checkpoint, context) => {
    const metadata = [
      checkpoint.artifactId,
      checkpoint.digest,
      checkpoint.byteSize,
      checkpoint.mediaType,
    ];
    if (checkpoint.captured !== metadata.every((value) => value !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "Captured checkpoints require a complete artifact manifest; withheld checkpoints require none.",
      });
    }
  });

const liveBrowserEventSchema = browserEventSchema.extend({
  id: evidenceIdSchema,
  sequence: z.number().int().positive().max(1_000_000),
  side: sideSchema,
});

export const liveBrowserEvidenceSchema: z.ZodType<LiveBrowserEvidence> = z
  .strictObject({
    status: liveBrowserStatusSchema,
    ledger: z.array(liveEvidenceEntrySchema).max(1_000),
    observations: z.array(liveObservationMetadataSchema).max(1_000),
    assertions: z.array(liveAssertionRecordSchema).max(1_000),
    matchedAssertionNames: z
      .array(
        z
          .string()
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
          .max(80),
      )
      .max(1_000),
    checkpoints: z.array(liveCheckpointRecordSchema).max(100),
    matchedCheckpointNames: z
      .array(
        z
          .string()
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
          .max(80),
      )
      .max(100),
    events: z.array(liveBrowserEventSchema).max(10_000),
  })
  .superRefine((evidence, context) => {
    const requireUnique = (
      values: readonly string[],
      path: readonly (string | number)[],
      label: string,
    ): void => {
      if (new Set(values).size !== values.length) {
        context.addIssue({ code: "custom", path: [...path], message: `${label} must be unique.` });
      }
    };
    const requireIncreasing = (
      values: readonly number[],
      path: readonly (string | number)[],
      label: string,
    ): void => {
      if (values.some((value, index) => index > 0 && value <= (values[index - 1] ?? 0))) {
        context.addIssue({
          code: "custom",
          path: [...path],
          message: `${label} must be strictly increasing.`,
        });
      }
    };
    const exactIntersection = (
      supplied: readonly string[],
      baseNames: readonly string[],
      headNames: readonly string[],
      path: "matchedAssertionNames" | "matchedCheckpointNames",
    ): void => {
      const head = new Set(headNames);
      const expected = [...new Set(baseNames.filter((name) => head.has(name)))].sort();
      if (supplied.length !== expected.length || supplied.some((name, index) => name !== expected[index])) {
        context.addIssue({
          code: "custom",
          path: [path],
          message: `${path} must be the sorted exact base/head intersection.`,
        });
      }
    };

    requireUnique(evidence.ledger.map(({ id }) => id), ["ledger"], "Ledger IDs");
    requireIncreasing(evidence.ledger.map(({ sequence }) => sequence), ["ledger"], "Ledger sequences");
    requireUnique(evidence.observations.map(({ id }) => id), ["observations"], "Observation IDs");
    requireUnique(evidence.assertions.map(({ id }) => id), ["assertions"], "Assertion IDs");
    requireUnique(
      evidence.assertions.map(({ name, side }) => `${side}:${name}`),
      ["assertions"],
      "Assertion side/name pairs",
    );
    requireIncreasing(
      evidence.assertions.map(({ sequence }) => sequence),
      ["assertions"],
      "Assertion sequences",
    );
    requireUnique(
      evidence.checkpoints.map(({ name, side }) => `${side}:${name}`),
      ["checkpoints"],
      "Checkpoint side/name pairs",
    );
    requireUnique(
      evidence.checkpoints.flatMap(({ artifactId }) => (artifactId ? [artifactId] : [])),
      ["checkpoints"],
      "Checkpoint artifact IDs",
    );
    requireUnique(evidence.events.map(({ id }) => id), ["events"], "Browser event IDs");
    requireIncreasing(evidence.events.map(({ sequence }) => sequence), ["events"], "Event sequences");
    exactIntersection(
      evidence.matchedAssertionNames,
      evidence.assertions.filter(({ side }) => side === "base").map(({ name }) => name),
      evidence.assertions.filter(({ side }) => side === "head").map(({ name }) => name),
      "matchedAssertionNames",
    );
    exactIntersection(
      evidence.matchedCheckpointNames,
      evidence.checkpoints
        .filter(({ side, captured }) => side === "base" && captured)
        .map(({ name }) => name),
      evidence.checkpoints
        .filter(({ side, captured }) => side === "head" && captured)
        .map(({ name }) => name),
      "matchedCheckpointNames",
    );
  });

export const liveBrowserEvidenceEnvelopeSchema = z.strictObject({
  evidence: liveBrowserEvidenceSchema,
});
