import { z } from "zod";

import type { Review } from "@trialrun/db";

export const publicProofRouteSchema = z.strictObject({
  reviewId: z.uuid(),
  token: z.string().regex(/^p1_[A-Za-z0-9_-]{43}$/),
});

const teardownProofSchema = z.strictObject({
  startedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }),
  providerProjectId: z.string().min(1).max(100),
  deleted: z.literal(true),
  message: z.string().min(1).max(2_000),
});

type PublicProofReviewFields = Pick<
  Review,
  | "provider"
  | "status"
  | "verdict"
  | "providerProjectId"
  | "teardownCompletedAt"
  | "teardownProof"
  | "cancelRequestedAt"
>;

export function isPublicProofReview(review: PublicProofReviewFields): boolean {
  if (
    review.provider !== "zerops" ||
    (review.status !== "tearing_down" && review.status !== "completed") ||
    (review.verdict !== "pass" && review.verdict !== "fail") ||
    !review.providerProjectId ||
    !review.teardownCompletedAt ||
    review.cancelRequestedAt
  ) {
    return false;
  }
  const proof = teardownProofSchema.safeParse(review.teardownProof);
  return proof.success && proof.data.providerProjectId === review.providerProjectId;
}
