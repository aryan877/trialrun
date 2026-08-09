import { describe, expect, it } from "vitest";

import { zeropsSchemasForTest } from "./zerops-provider";

describe("Zerops API response validation", () => {
  it("collects logs with a fresh bounded signal after the review signal is aborted", () => {
    const review = new AbortController();
    review.abort(new Error("Review cancelled."));

    const logSignal = zeropsSchemasForTest.independentApplicationLogSignal();

    expect(review.signal.aborted).toBe(true);
    expect(logSignal).not.toBe(review.signal);
    expect(logSignal.aborted).toBe(false);
  });

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

  it("accepts only Zerops' exact documented project-not-found response as absence", () => {
    expect(
      zeropsSchemasForTest.isZeropsProjectAbsentResponse(400, {
        error: { code: "projectNotFound", message: "Project not found." },
      }),
    ).toBe(true);
    expect(
      zeropsSchemasForTest.isZeropsProjectAbsentResponse(400, {
        error: { code: "validationFailed", message: "Bad request." },
      }),
    ).toBe(false);
    expect(zeropsSchemasForTest.isZeropsProjectAbsentResponse(404, null)).toBe(false);
    expect(
      zeropsSchemasForTest.isZeropsProjectAbsentResponse(500, {
        error: { code: "projectNotFound", message: "Project not found." },
      }),
    ).toBe(false);
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

  it("accepts only the exact Zerops-provided URL for the public executor", () => {
    const service = {
      id: "executor-service",
      name: "executor",
      status: "ACTIVE",
      subdomainAccess: true,
      userData: [
        {
          key: "zeropsSubdomain",
          content: "https://executor-trialrun-proof-3000.prg1.zerops.app",
        },
      ],
    };

    expect(zeropsSchemasForTest.publicUrlFromService(service, "executor", 3_000)).toBe(
      "https://executor-trialrun-proof-3000.prg1.zerops.app",
    );
    expect(() =>
      zeropsSchemasForTest.publicUrlFromService(
        {
          ...service,
          userData: [{ key: "zeropsSubdomain", content: "https://example.com" }],
        },
        "executor",
        3_000,
      ),
    ).toThrow(/invalid generated subdomain URL/);
    expect(() =>
      zeropsSchemasForTest.publicUrlFromService(
        {
          ...service,
          userData: [
            ...service.userData,
            { key: "zeropsSubdomain", content: service.userData[0]!.content },
          ],
        },
        "executor",
        3_000,
      ),
    ).toThrow(/exactly one/);
    expect(() =>
      zeropsSchemasForTest.publicUrlFromService(
        {
          ...service,
          userData: [{ key: "zeropsSubdomain", content: "not-a-url" }],
        },
        "executor",
        3_000,
      ),
    ).toThrow(/invalid generated subdomain URL/);
  });
});
