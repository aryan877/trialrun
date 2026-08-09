import { z } from "zod";

import { safeRelativePathSchema } from "./recipe";

const gitShaSchema = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "Expected a lowercase 40-character Git SHA.");
const identifierSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, "Use a lowercase kebab-case identifier.")
  .max(80);
const secretNameSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/);

export const agentCapabilities = [
  "read_repository",
  "read_diff",
  "observe_browser",
  "count_locators",
  "act_browser",
  "inspect_browser_events",
  "request_application",
  "read_application_logs",
  "switch_side",
  "reset_side",
  "capture_checkpoint",
] as const;

export const agentCapabilitySchema = z.enum(agentCapabilities);
export type AgentCapability = z.infer<typeof agentCapabilitySchema>;

export const agentMissionBudgetLimits = {
  maxToolCalls: 250,
  maxDurationSeconds: 3_600,
  maxCheckpoints: 20,
  maxResets: 6,
} as const;

export const agentMissionGoalKinds = [
  "understand_change",
  "review_code_risks",
  "investigate_live_behavior",
] as const;

export const agentMissionGoalSchema = z.strictObject({
  id: identifierSchema,
  kind: z.enum(agentMissionGoalKinds),
  objective: z.string().min(1).max(500),
  priority: z.enum(["high", "medium", "low"]),
});

export const agentMissionQuestionSchema = z.strictObject({
  id: identifierSchema,
  question: z.string().min(1).max(500),
});

export const agentMissionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    missionId: z.string().uuid(),
    reviewId: z.string().uuid(),
    baseSha: gitShaSchema,
    headSha: gitShaSchema,
    title: z.string().min(1).max(160),
    goals: z.array(agentMissionGoalSchema).min(3).max(12),
    questions: z.array(agentMissionQuestionSchema).min(1).max(20),
    allowedSecretNames: z.array(secretNameSchema).max(20),
    capabilities: z.array(agentCapabilitySchema).min(1).max(agentCapabilities.length),
    budgets: z.strictObject({
      maxToolCalls: z.number().int().min(1).max(agentMissionBudgetLimits.maxToolCalls),
      maxDurationSeconds: z.number().int().min(30).max(agentMissionBudgetLimits.maxDurationSeconds),
      maxCheckpoints: z.number().int().nonnegative().max(agentMissionBudgetLimits.maxCheckpoints),
      maxResets: z.number().int().nonnegative().max(agentMissionBudgetLimits.maxResets),
    }),
  })
  .superRefine((mission, context) => {
    const goalIds = mission.goals.map(({ id }) => id);
    if (new Set(goalIds).size !== goalIds.length) {
      context.addIssue({ code: "custom", path: ["goals"], message: "Goal IDs must be unique." });
    }
    for (const kind of agentMissionGoalKinds) {
      if (!mission.goals.some((goal) => goal.kind === kind)) {
        context.addIssue({
          code: "custom",
          path: ["goals"],
          message: `A holistic mission needs a ${kind} goal.`,
        });
      }
    }

    const questionIds = mission.questions.map(({ id }) => id);
    if (new Set(questionIds).size !== questionIds.length) {
      context.addIssue({
        code: "custom",
        path: ["questions"],
        message: "Question IDs must be unique.",
      });
    }
    if (new Set(mission.allowedSecretNames).size !== mission.allowedSecretNames.length) {
      context.addIssue({
        code: "custom",
        path: ["allowedSecretNames"],
        message: "Allowed secret names must be unique.",
      });
    }

    const capabilities = new Set<AgentCapability>(mission.capabilities);
    if (capabilities.size !== mission.capabilities.length) {
      context.addIssue({
        code: "custom",
        path: ["capabilities"],
        message: "Capabilities must be unique.",
      });
    }
    for (const required of ["read_repository", "read_diff"] as const) {
      if (!capabilities.has(required)) {
        context.addIssue({
          code: "custom",
          path: ["capabilities"],
          message: `A holistic mission requires ${required}.`,
        });
      }
    }
    if (!capabilities.has("observe_browser") && !capabilities.has("request_application")) {
      context.addIssue({
        code: "custom",
        path: ["capabilities"],
        message: "A live mission must allow browser observation or approved application requests.",
      });
    }
    if (
      capabilities.has("act_browser") &&
      (!capabilities.has("observe_browser") || !capabilities.has("count_locators"))
    ) {
      context.addIssue({
        code: "custom",
        path: ["capabilities"],
        message: "Browser actions require observation and locator counting capabilities.",
      });
    }
    if (mission.budgets.maxCheckpoints > 0 && !capabilities.has("capture_checkpoint")) {
      context.addIssue({
        code: "custom",
        path: ["budgets", "maxCheckpoints"],
        message: "A positive checkpoint budget requires capture_checkpoint.",
      });
    }
    if (mission.budgets.maxResets > 0 && !capabilities.has("reset_side")) {
      context.addIssue({
        code: "custom",
        path: ["budgets", "maxResets"],
        message: "A positive reset budget requires reset_side.",
      });
    }
  });

export type AgentMission = z.infer<typeof agentMissionSchema>;

export const agentUsageSchema = z.strictObject({
  input_tokens: z.number().int().nonnegative().safe(),
  cached_input_tokens: z.number().int().nonnegative().safe(),
  cache_write_input_tokens: z.number().int().nonnegative().safe(),
  output_tokens: z.number().int().nonnegative().safe(),
  reasoning_output_tokens: z.number().int().nonnegative().safe(),
});

export type AgentUsage = z.infer<typeof agentUsageSchema>;

export const agentRunMetricsSchema = z.strictObject({
  usage: agentUsageSchema,
  toolCalls: z.number().int().nonnegative().max(agentMissionBudgetLimits.maxToolCalls),
  startedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }),
});

export type AgentRunMetrics = z.infer<typeof agentRunMetricsSchema>;

const repositoryFilePathSchema = safeRelativePathSchema.refine(
  (path) => path !== ".",
  "A finding citation must name a repository file.",
);

export const repositoryLineCitationSchema = z
  .strictObject({
    path: repositoryFilePathSchema,
    lineStart: z.number().int().positive().max(1_000_000),
    lineEnd: z.number().int().positive().max(1_000_000),
  })
  .superRefine((citation, context) => {
    if (citation.lineEnd < citation.lineStart) {
      context.addIssue({
        code: "custom",
        path: ["lineEnd"],
        message: "lineEnd cannot precede lineStart.",
      });
    } else if (citation.lineEnd - citation.lineStart >= 200) {
      context.addIssue({
        code: "custom",
        path: ["lineEnd"],
        message: "A code-risk citation may span at most 200 lines.",
      });
    }
  });

export type RepositoryLineCitation = z.infer<typeof repositoryLineCitationSchema>;

export const recordedEvidenceIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/, "Expected an opaque recorded evidence ID.");

const codeRiskVerificationSchema = z
  .strictObject({
    state: z.enum(["unproven", "reproduced"]),
    reason: z.string().max(1_000),
    evidenceIds: z.array(recordedEvidenceIdSchema).max(50),
  })
  .superRefine((verification, context) => {
    if (
      verification.state === "unproven" &&
      (verification.reason.length === 0 || verification.evidenceIds.length !== 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "An unproven code risk requires a reason and no reproduction evidence IDs.",
      });
    }
    if (
      verification.state === "reproduced" &&
      (verification.reason.length !== 0 || verification.evidenceIds.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "A reproduced code risk requires evidence IDs and an empty reason.",
      });
    }
  });

export const staticCodeRiskFindingSchema = z
  .strictObject({
    id: identifierSchema,
    sourceSha: gitShaSchema,
    category: z.enum(["correctness", "security", "reliability", "maintainability", "architecture"]),
    risk: z.enum(["high", "medium", "low"]),
    title: z.string().min(1).max(240),
    summary: z.string().min(1).max(2_000),
    citations: z.array(repositoryLineCitationSchema).min(1).max(10),
    verification: codeRiskVerificationSchema,
  })
  .superRefine((finding, context) => {
    const citationKeys = finding.citations.map(
      ({ path, lineStart, lineEnd }) => `${path}:${lineStart}:${lineEnd}`,
    );
    if (new Set(citationKeys).size !== citationKeys.length) {
      context.addIssue({
        code: "custom",
        path: ["citations"],
        message: "Finding citations must be unique.",
      });
    }
    if (
      finding.verification.state === "reproduced" &&
      new Set(finding.verification.evidenceIds).size !== finding.verification.evidenceIds.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["verification", "evidenceIds"],
        message: "Reproduction evidence IDs must be unique.",
      });
    }
  });

export type StaticCodeRiskFinding = z.infer<typeof staticCodeRiskFindingSchema>;

export const staticCodeStrengthFindingSchema = z
  .strictObject({
    id: identifierSchema,
    sourceSha: gitShaSchema,
    category: z.enum(["correctness", "security", "reliability", "maintainability", "architecture"]),
    title: z.string().min(1).max(240),
    summary: z.string().min(1).max(2_000),
    citations: z.array(repositoryLineCitationSchema).min(1).max(10),
  })
  .superRefine((finding, context) => {
    const citationKeys = finding.citations.map(
      ({ path, lineStart, lineEnd }) => `${path}:${lineStart}:${lineEnd}`,
    );
    if (new Set(citationKeys).size !== citationKeys.length) {
      context.addIssue({
        code: "custom",
        path: ["citations"],
        message: "Strength citations must be unique.",
      });
    }
  });

export type StaticCodeStrengthFinding = z.infer<typeof staticCodeStrengthFindingSchema>;

export const agentQuestionAnswerSchema = z.strictObject({
  questionId: identifierSchema,
  answer: z.string().min(1).max(2_000),
  evidenceIds: z.array(recordedEvidenceIdSchema).max(50),
});

export const agentTerminalReportSchema = z
  .strictObject({
    schemaVersion: z.literal(2),
    missionId: z.string().uuid(),
    termination: z.enum(["mission_complete", "budget_exhausted", "cancelled", "tool_error"]),
    verdict: z.enum(["pass", "fail", "inconclusive"]),
    evidenceSummary: z.string().min(1).max(4_000),
    evidenceIds: z.array(recordedEvidenceIdSchema).min(1).max(250),
    questionAnswers: z.array(agentQuestionAnswerSchema).max(20),
    codeStrengths: z.array(staticCodeStrengthFindingSchema).max(30),
    codeRiskFindings: z.array(staticCodeRiskFindingSchema).max(50),
    limitations: z.array(z.string().min(1).max(500)).max(20),
  })
  .superRefine((report, context) => {
    const recordedEvidenceIds = new Set(report.evidenceIds);
    if (recordedEvidenceIds.size !== report.evidenceIds.length) {
      context.addIssue({
        code: "custom",
        path: ["evidenceIds"],
        message: "Recorded evidence IDs must be unique.",
      });
    }

    const questionIds = report.questionAnswers.map(({ questionId }) => questionId);
    if (new Set(questionIds).size !== questionIds.length) {
      context.addIssue({
        code: "custom",
        path: ["questionAnswers"],
        message: "Each mission question may be answered once.",
      });
    }
    for (const [answerIndex, answer] of report.questionAnswers.entries()) {
      if (new Set(answer.evidenceIds).size !== answer.evidenceIds.length) {
        context.addIssue({
          code: "custom",
          path: ["questionAnswers", answerIndex, "evidenceIds"],
          message: "Answer evidence IDs must be unique.",
        });
      }
      for (const [evidenceIndex, evidenceId] of answer.evidenceIds.entries()) {
        if (!recordedEvidenceIds.has(evidenceId)) {
          context.addIssue({
            code: "custom",
            path: ["questionAnswers", answerIndex, "evidenceIds", evidenceIndex],
            message: "Question answers may reference only evidence IDs declared by the report.",
          });
        }
      }
    }

    const findingIds = report.codeRiskFindings.map(({ id }) => id);
    if (new Set(findingIds).size !== findingIds.length) {
      context.addIssue({
        code: "custom",
        path: ["codeRiskFindings"],
        message: "Code-risk finding IDs must be unique.",
      });
    }
    const strengthIds = report.codeStrengths.map(({ id }) => id);
    if (new Set(strengthIds).size !== strengthIds.length) {
      context.addIssue({
        code: "custom",
        path: ["codeStrengths"],
        message: "Code-strength finding IDs must be unique.",
      });
    }
    for (const [findingIndex, finding] of report.codeRiskFindings.entries()) {
      if (finding.verification.state !== "reproduced") continue;
      for (const [evidenceIndex, evidenceId] of finding.verification.evidenceIds.entries()) {
        if (!recordedEvidenceIds.has(evidenceId)) {
          context.addIssue({
            code: "custom",
            path: ["codeRiskFindings", findingIndex, "verification", "evidenceIds", evidenceIndex],
            message: "Reproduced findings may reference only evidence IDs declared by the report.",
          });
        }
      }
    }
  });

export type AgentTerminalReport = z.infer<typeof agentTerminalReportSchema>;
