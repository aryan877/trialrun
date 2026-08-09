import { describe, expect, it } from "vitest";

import { publicRuntimeContent } from "./public-runtime";

const completeProof = {
  TRIALRUN_PROOF_BASE_SHA: "a".repeat(40),
  TRIALRUN_PROOF_BASE_WEBM_URL: "/proof/base.webm",
  TRIALRUN_PROOF_HEAD_SHA: "b".repeat(40),
  TRIALRUN_PROOF_HEAD_WEBM_URL: "https://evidence.example.test/head.webm",
  TRIALRUN_PROOF_GITHUB_CHECK_URL: "https://github.com/example/repository/runs/123",
  TRIALRUN_PROOF_REVIEW_URL: "/app/reviews/11111111-1111-4111-8111-111111111111",
  TRIALRUN_PROOF_SUMMARY: "The pull request changes the checkout total after submit.",
  TRIALRUN_PROOF_TEARDOWN_SUMMARY:
    "Deleted the exact Zerops review project; projectNotFound was observed.",
} as const;
describe("public landing runtime content", () => {
  it("stays empty when deployment values are absent", () => {
    expect(publicRuntimeContent({})).toEqual({ proof: null });
  });

  it("renders proof only as one complete, exact base and pull-request pair", () => {
    expect(publicRuntimeContent(completeProof).proof).toEqual({
      baseSha: "a".repeat(40),
      baseWebmUrl: "/proof/base.webm",
      headSha: "b".repeat(40),
      headWebmUrl: "https://evidence.example.test/head.webm",
      githubCheckUrl: "https://github.com/example/repository/runs/123",
      reviewUrl: "/app/reviews/11111111-1111-4111-8111-111111111111",
      summary: "The pull request changes the checkout total after submit.",
      teardownSummary: "Deleted the exact Zerops review project; projectNotFound was observed.",
    });
    expect(
      publicRuntimeContent({ ...completeProof, TRIALRUN_PROOF_HEAD_WEBM_URL: undefined }).proof,
    ).toBeNull();
    expect(
      publicRuntimeContent({ ...completeProof, TRIALRUN_PROOF_HEAD_SHA: "short" }).proof,
    ).toBeNull();
    expect(
      publicRuntimeContent({
        ...completeProof,
        TRIALRUN_PROOF_GITHUB_CHECK_URL: undefined,
      }).proof,
    ).toBeNull();
    expect(
      publicRuntimeContent({
        ...completeProof,
        TRIALRUN_PROOF_TEARDOWN_SUMMARY: undefined,
      }).proof,
    ).toBeNull();
  });

  it("rejects credential-bearing and executable proof URLs", () => {
    for (const unsafeUrl of [
      "javascript:alert(1)",
      "data:video/webm;base64,AAAA",
      "https://user:password@example.test/proof.webm",
      "//example.test/proof.webm",
      "/proof\\head.webm",
    ]) {
      expect(
        publicRuntimeContent({ ...completeProof, TRIALRUN_PROOF_HEAD_WEBM_URL: unsafeUrl }).proof,
      ).toBeNull();
      expect(
        publicRuntimeContent({
          ...completeProof,
          TRIALRUN_PROOF_GITHUB_CHECK_URL: unsafeUrl,
        }).proof,
      ).toBeNull();
    }
  });
});
