import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  agentMissionBudgetLimits,
  agentMissionSchema,
  agentRunMetricsSchema,
  agentTerminalReportSchema,
  staticCodeRiskFindingSchema,
  type AgentMission,
  type AgentTerminalReport,
  type StaticCodeRiskFinding,
} from "./agent";

const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);

it("validates persisted SDK usage without depending on the SDK package", () => {
  expect(
    agentRunMetricsSchema.parse({
      usage: {
        input_tokens: 10,
        cached_input_tokens: 3,
        cache_write_input_tokens: 2,
        output_tokens: 4,
        reasoning_output_tokens: 1,
      },
      toolCalls: 8,
      startedAt: "2026-08-08T10:00:00.000Z",
      completedAt: "2026-08-08T10:01:00.000Z",
    }).toolCalls,
  ).toBe(8);
});

function mission(): AgentMission {
  return {
    schemaVersion: 1,
    missionId: "7ed9b4b8-a591-4a35-a71a-9c1dc6b83d4d",
    reviewId: "82d1a2bc-752c-40b4-af2a-eb3ca95731de",
    baseSha,
    headSha,
    title: "Review checkout correctness and prove the highest-value risks live",
    goals: [
      {
        id: "understand-checkout",
        kind: "understand_change",
        objective: "Understand the checkout change in repository context.",
        priority: "high",
      },
      {
        id: "review-risks",
        kind: "review_code_risks",
        objective: "Identify exact correctness and security risks with file and line citations.",
        priority: "high",
      },
      {
        id: "investigate-runtime",
        kind: "investigate_live_behavior",
        objective: "Investigate the most important hypotheses against both live sides.",
        priority: "high",
      },
    ],
    questions: [
      {
        id: "order-created-once",
        question: "Does one checkout submission create exactly one order on both sides?",
      },
    ],
    allowedSecretNames: ["TEST_CARD_TOKEN"],
    capabilities: [
      "read_repository",
      "read_diff",
      "observe_browser",
      "count_locators",
      "act_browser",
      "inspect_browser_events",
      "read_application_logs",
      "switch_side",
      "reset_side",
      "capture_checkpoint",
    ],
    budgets: {
      maxToolCalls: 120,
      maxDurationSeconds: 1_200,
      maxCheckpoints: 8,
      maxResets: 2,
    },
  };
}

function unprovenFinding(): StaticCodeRiskFinding {
  return {
    id: "non-atomic-order-write",
    sourceSha: headSha,
    category: "correctness",
    risk: "high",
    title: "Order creation is not atomic",
    summary: "The order and line items can be committed separately.",
    citations: [{ path: "src/checkout/create-order.ts", lineStart: 42, lineEnd: 67 }],
    verification: {
      state: "unproven",
      reason: "Static inspection found the risk, but no recorded live reproduction exists yet.",
      evidenceIds: [],
    },
  };
}

function reproducedFinding(): StaticCodeRiskFinding {
  return {
    ...unprovenFinding(),
    verification: {
      state: "reproduced",
      reason: "",
      evidenceIds: ["event:104", "artifact:checkout-head"],
    },
  };
}

function report(): AgentTerminalReport {
  return {
    schemaVersion: 2,
    missionId: mission().missionId,
    termination: "mission_complete",
    verdict: "fail",
    evidenceSummary: "The reproduced checkout defect makes this pull request unsafe to merge.",
    evidenceIds: ["event:104", "artifact:checkout-head"],
    questionAnswers: [
      {
        questionId: "order-created-once",
        answer: "The head-side submission produced the recorded duplicate-order behavior.",
        evidenceIds: ["event:104"],
      },
    ],
    codeStrengths: [
      {
        id: "validated-checkout-input",
        sourceSha: headSha,
        category: "correctness",
        title: "Checkout input is validated at the boundary",
        summary: "The handler validates the request before order construction.",
        citations: [{ path: "src/checkout/create-order.ts", lineStart: 8, lineEnd: 18 }],
      },
    ],
    codeRiskFindings: [reproducedFinding()],
    limitations: ["Only the declared checkout journey was investigated live."],
  };
}

describe("agent contracts", () => {
  it("accepts a holistic live mission and rejects prerecorded browser steps", () => {
    expect(agentMissionSchema.safeParse(mission()).success).toBe(true);
    expect(
      agentMissionSchema.safeParse({
        ...mission(),
        steps: [{ action: "click", target: "submit" }],
      }).success,
    ).toBe(false);

    const missingRuntimeGoal = mission();
    missingRuntimeGoal.goals = missingRuntimeGoal.goals.filter(
      ({ kind }) => kind !== "investigate_live_behavior",
    );
    expect(agentMissionSchema.safeParse(missingRuntimeGoal).success).toBe(false);
    expect(agentMissionSchema.safeParse({ ...mission(), questions: [] }).success).toBe(false);
  });

  it("enforces every mission budget ceiling", () => {
    expect(
      agentMissionSchema.safeParse({
        ...mission(),
        budgets: {
          ...mission().budgets,
          maxToolCalls: agentMissionBudgetLimits.maxToolCalls + 1,
        },
      }).success,
    ).toBe(false);
    expect(
      agentMissionSchema.safeParse({
        ...mission(),
        budgets: {
          ...mission().budgets,
          maxDurationSeconds: agentMissionBudgetLimits.maxDurationSeconds + 1,
        },
      }).success,
    ).toBe(false);
    expect(
      agentMissionSchema.safeParse({
        ...mission(),
        budgets: {
          ...mission().budgets,
          maxCheckpoints: agentMissionBudgetLimits.maxCheckpoints + 1,
        },
      }).success,
    ).toBe(false);
    expect(
      agentMissionSchema.safeParse({
        ...mission(),
        budgets: {
          ...mission().budgets,
          maxResets: agentMissionBudgetLimits.maxResets + 1,
        },
      }).success,
    ).toBe(false);
  });

  it("requires unique allowed secrets and capability-compatible budgets", () => {
    expect(
      agentMissionSchema.safeParse({
        ...mission(),
        allowedSecretNames: ["TEST_CARD_TOKEN", "TEST_CARD_TOKEN"],
      }).success,
    ).toBe(false);
    expect(
      agentMissionSchema.safeParse({
        ...mission(),
        allowedSecretNames: ["not_a_secret_name"],
      }).success,
    ).toBe(false);
    expect(
      agentMissionSchema.safeParse({
        ...mission(),
        capabilities: mission().capabilities.filter((capability) => capability !== "reset_side"),
      }).success,
    ).toBe(false);
    expect(
      agentMissionSchema.safeParse({
        ...mission(),
        capabilities: ["read_repository", "read_diff", "request_application"],
        budgets: { ...mission().budgets, maxCheckpoints: 0, maxResets: 0 },
      }).success,
    ).toBe(true);
  });

  it("requires exact safe file and line citations", () => {
    expect(staticCodeRiskFindingSchema.safeParse(unprovenFinding()).success).toBe(true);
    expect(
      staticCodeRiskFindingSchema.safeParse({
        ...unprovenFinding(),
        citations: [{ path: "../secret.ts", lineStart: 1, lineEnd: 1 }],
      }).success,
    ).toBe(false);
    expect(
      staticCodeRiskFindingSchema.safeParse({
        ...unprovenFinding(),
        citations: [{ path: ".", lineStart: 1, lineEnd: 1 }],
      }).success,
    ).toBe(false);
    expect(
      staticCodeRiskFindingSchema.safeParse({
        ...unprovenFinding(),
        citations: [{ path: "src/order.ts", lineStart: 0, lineEnd: 1 }],
      }).success,
    ).toBe(false);
    expect(
      staticCodeRiskFindingSchema.safeParse({
        ...unprovenFinding(),
        citations: [{ path: "src/order.ts", lineStart: 20, lineEnd: 19 }],
      }).success,
    ).toBe(false);
    expect(
      staticCodeRiskFindingSchema.safeParse({
        ...unprovenFinding(),
        citations: [{ path: "src/order.ts", lineStart: 1, lineEnd: 201 }],
      }).success,
    ).toBe(false);
  });

  it("makes the unproven versus reproduced state explicit", () => {
    expect(staticCodeRiskFindingSchema.safeParse(reproducedFinding()).success).toBe(true);
    expect(
      staticCodeRiskFindingSchema.safeParse({
        ...unprovenFinding(),
        verification: { state: "reproduced", reason: "", evidenceIds: [] },
      }).success,
    ).toBe(false);
    expect(
      staticCodeRiskFindingSchema.safeParse({
        ...unprovenFinding(),
        verification: {
          state: "unproven",
          reason: "No live evidence exists.",
          evidenceIds: ["event:104"],
        },
      }).success,
    ).toBe(false);
  });

  it("emits a Codex structured-output schema without unsupported oneOf unions", () => {
    const schema = z.toJSONSchema(agentTerminalReportSchema, { target: "draft-7" });
    expect(JSON.stringify(schema)).not.toContain('"oneOf"');
    const structuredOutputShape = z.object({
      properties: z.object({
        codeRiskFindings: z.object({
          items: z.object({
            properties: z.object({
              verification: z.object({ required: z.array(z.string()) }),
            }),
          }),
        }),
      }),
    });
    expect(
      structuredOutputShape.parse(schema).properties.codeRiskFindings.items.properties.verification
        .required,
    ).toEqual(["state", "reason", "evidenceIds"]);
  });

  it("accepts only declared recorded evidence references in a terminal report", () => {
    expect(agentTerminalReportSchema.safeParse(report()).success).toBe(true);
    expect(agentTerminalReportSchema.safeParse({ ...report(), evidenceIds: [] }).success).toBe(
      false,
    );
    const unknownEvidence = report();
    unknownEvidence.questionAnswers[0] = {
      ...unknownEvidence.questionAnswers[0]!,
      evidenceIds: ["event:999"],
    };
    expect(agentTerminalReportSchema.safeParse(unknownEvidence).success).toBe(false);
  });

  it("requires Codex to return the review verdict", () => {
    for (const verdict of ["pass", "fail", "inconclusive"] as const) {
      expect(agentTerminalReportSchema.safeParse({ ...report(), verdict }).success).toBe(true);
    }
    const withoutVerdict = Object.fromEntries(
      Object.entries(report()).filter(([key]) => key !== "verdict"),
    );
    expect(agentTerminalReportSchema.safeParse(withoutVerdict).success).toBe(false);
    expect(agentTerminalReportSchema.keyof().options).toContain("verdict");
    expect(agentTerminalReportSchema.keyof().options).not.toContain("passed");
  });

  it("requires exact citations for positive code evidence too", () => {
    const candidate = report();
    candidate.codeStrengths[0] = {
      ...candidate.codeStrengths[0]!,
      citations: [{ path: "../outside.ts", lineStart: 1, lineEnd: 2 }],
    };
    expect(agentTerminalReportSchema.safeParse(candidate).success).toBe(false);
  });
});
