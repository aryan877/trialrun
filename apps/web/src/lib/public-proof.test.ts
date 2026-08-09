import { describe, expect, it } from "vitest";

import { isPublicProofReview } from "./public-proof-contract";

const proof = {
  startedAt: "2026-08-09T05:30:40.934Z",
  completedAt: "2026-08-09T05:31:13.299Z",
  providerProjectId: "QBIcDNmXRCCJJLwD8iak6g",
  deleted: true,
  message: "The exact project endpoint returned projectNotFound.",
} as const;

function review(overrides: Partial<Parameters<typeof isPublicProofReview>[0]> = {}) {
  return {
    provider: "zerops" as const,
    status: "completed" as const,
    verdict: "fail" as const,
    providerProjectId: proof.providerProjectId,
    teardownCompletedAt: new Date(proof.completedAt),
    teardownProof: proof,
    cancelRequestedAt: null,
    ...overrides,
  };
}

describe("public proof eligibility", () => {
  it("serves only conclusive Zerops evidence after exact deletion proof", () => {
    expect(isPublicProofReview(review())).toBe(true);
    expect(isPublicProofReview(review({ status: "tearing_down" }))).toBe(true);
    expect(isPublicProofReview(review({ provider: "local" }))).toBe(false);
    expect(isPublicProofReview(review({ verdict: "inconclusive" }))).toBe(false);
    expect(isPublicProofReview(review({ status: "inconclusive" }))).toBe(false);
    expect(isPublicProofReview(review({ cancelRequestedAt: new Date() }))).toBe(false);
    expect(isPublicProofReview(review({ teardownCompletedAt: null }))).toBe(false);
    expect(
      isPublicProofReview(
        review({ teardownProof: { ...proof, providerProjectId: "another-project" } }),
      ),
    ).toBe(false);
  });
});
