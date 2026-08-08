import { describe, expect, it } from "vitest";

import { zeropsSchemasForTest } from "./zerops-provider";

describe("Zerops API response validation", () => {
  it("accepts the SDK-backed project import shape", () => {
    expect(
      zeropsSchemasForTest.importResponseSchema.parse({
        projectId: "Evs8Je4NTvKeIkUqoUXp2w",
        projectName: "trialrun-review",
        serviceStacks: [
          {
            id: "stack-base",
            name: "base",
            processes: [{ id: "process-1", status: "PENDING", sequence: 1 }],
          },
        ],
      }).projectId,
    ).toBe("Evs8Je4NTvKeIkUqoUXp2w");
  });

  it("rejects an undocumented process status", () => {
    expect(() =>
      zeropsSchemasForTest.processSchema.parse({ id: "process-1", status: "DONE" }),
    ).toThrow();
  });

  it("requires the exact persisted ownership marker before project deletion", () => {
    const expected = {
      projectId: "project-owned",
      clientId: "client-owned",
      description: `TrialRun review review-owned; ownership-sha256=${"a".repeat(64)}`,
    };
    const project = {
      id: expected.projectId,
      clientId: expected.clientId,
      description: expected.description,
      tagList: ["ephemeral-review", "trialrun", "zerops-system-tag"],
      status: "ACTIVE",
      zeropsSubdomainHost: "owned.zerops.app",
    };

    expect(() => zeropsSchemasForTest.assertOwnedReviewProject(project, expected)).not.toThrow();
    expect(() =>
      zeropsSchemasForTest.assertOwnedReviewProject(
        { ...project, description: "another review" },
        expected,
      ),
    ).toThrow(/ownership marker/);
    expect(() =>
      zeropsSchemasForTest.assertOwnedReviewProject(
        { ...project, tagList: ["trialrun"] },
        expected,
      ),
    ).toThrow(/ownership marker/);
  });
});
