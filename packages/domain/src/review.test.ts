import { describe, expect, it } from "vitest";

import { compareRuns, testPlanSchema, type SideRunResult } from "./review";

function side(sideName: "base" | "head", passed: boolean): SideRunResult {
  return {
    side: sideName,
    baseUrl: `http://127.0.0.1:${sideName === "base" ? "4101" : "4102"}`,
    startedAt: "2026-08-08T00:00:00.000Z",
    completedAt: "2026-08-08T00:00:01.000Z",
    artifactPolicy: "full",
    assertions: [
      {
        step: 0,
        label: "POST /api/orders returns 201",
        passed,
        expected: "HTTP 201",
        actual: passed ? "HTTP 201" : "HTTP 500",
      },
    ],
    browserEvents: [],
    checkpoints: [{ name: "before-submit", artifactPath: `/tmp/${sideName}.png` }],
    tracePath: `/tmp/${sideName}.zip`,
    videoPath: `/tmp/${sideName}.webm`,
    observationsPath: `/tmp/${sideName}.json`,
  };
}

describe("review oracle", () => {
  it("fails only when base passes and head fails", () => {
    expect(compareRuns(side("base", true), side("head", false)).verdict).toBe("fail");
  });

  it("is inconclusive when the base is invalid", () => {
    expect(compareRuns(side("base", false), side("head", false)).verdict).toBe("inconclusive");
  });

  it("accepts only bounded declarative plans", () => {
    expect(
      testPlanSchema.safeParse({
        version: 1,
        title: "Checkout persists an order",
        rationale: "The PR changes checkout behavior.",
        requiredSecretNames: [],
        steps: [
          { action: "goto", path: "/", waitUntil: "domcontentloaded" },
          { action: "checkpoint", name: "loaded" },
        ],
      }).success,
    ).toBe(true);
  });

  it("never passes empty or incomplete evidence", () => {
    const complete = side("base", true);
    const headWithoutTrace = { ...side("head", true) };
    Reflect.deleteProperty(headWithoutTrace, "tracePath");
    expect(
      compareRuns(
        { ...complete, assertions: [] },
        { ...side("head", true), assertions: [] },
      ).verdict,
    ).toBe("inconclusive");
    expect(
      compareRuns(complete, headWithoutTrace).verdict,
    ).toBe("inconclusive");
  });

  it("reports only the first divergent step", () => {
    const head = side("head", false);
    expect(compareRuns(side("base", true), head).findings).toHaveLength(1);
  });
});
