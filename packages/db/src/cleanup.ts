import { and, asc, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";

import type { TrialRunDatabase } from "./client";
import { reviews } from "./schema";

const terminalReviewStatuses = ["completed", "inconclusive", "cancelled"] as const;

export interface ZeropsCleanupClaim {
  readonly reviewId: string;
  readonly providerProjectId: string;
  readonly providerOwnershipTokenHash: string | null;
  readonly claimantId: string;
  readonly attempt: number;
  readonly maxAttempts: number;
}

export interface ZeropsCleanupProof {
  readonly startedAt: string;
  readonly completedAt: string;
  readonly providerProjectId: string;
  readonly deleted: boolean;
  readonly message: string;
}

export interface ZeropsCleanupFailure {
  readonly exhausted: boolean;
  readonly retryAt: Date | null;
}

function validateLease(claimantId: string, leaseSeconds: number): void {
  if (claimantId.trim().length === 0 || claimantId.length > 160) {
    throw new Error("Cleanup claimant ID must contain between 1 and 160 characters.");
  }
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 900) {
    throw new Error("Cleanup lease must be between 30 and 900 seconds.");
  }
}

export async function claimNextZeropsCleanup(
  db: TrialRunDatabase,
  claimantId: string,
  leaseSeconds: number,
): Promise<ZeropsCleanupClaim | null> {
  validateLease(claimantId, leaseSeconds);
  return db.transaction(async (tx) => {
    const now = new Date();
    const [candidate] = await tx
      .select({
        reviewId: reviews.id,
        providerProjectId: reviews.providerProjectId,
        providerOwnershipTokenHash: reviews.providerOwnershipTokenHash,
        teardownAttempts: reviews.teardownAttempts,
        teardownMaxAttempts: reviews.teardownMaxAttempts,
        teardownStartedAt: reviews.teardownStartedAt,
      })
      .from(reviews)
      .where(
        and(
          eq(reviews.provider, "zerops"),
          isNotNull(reviews.providerProjectId),
          isNull(reviews.teardownCompletedAt),
          inArray(reviews.status, terminalReviewStatuses),
          sql`${reviews.teardownAttempts} < ${reviews.teardownMaxAttempts}`,
          or(
            and(isNull(reviews.teardownLockedBy), lte(reviews.teardownAvailableAt, now)),
            lte(reviews.teardownLeaseExpiresAt, now),
          ),
        ),
      )
      .orderBy(asc(reviews.teardownAvailableAt), asc(reviews.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });

    if (!candidate?.providerProjectId) return null;
    const attempt = candidate.teardownAttempts + 1;
    const [claimed] = await tx
      .update(reviews)
      .set({
        teardownAttempts: attempt,
        teardownStartedAt: candidate.teardownStartedAt ?? now,
        teardownLockedBy: claimantId,
        teardownLeaseExpiresAt: new Date(now.getTime() + leaseSeconds * 1_000),
        teardownLastError: null,
      })
      .where(
        and(
          eq(reviews.id, candidate.reviewId),
          eq(reviews.providerProjectId, candidate.providerProjectId),
          eq(reviews.teardownAttempts, candidate.teardownAttempts),
          isNull(reviews.teardownCompletedAt),
        ),
      )
      .returning({ reviewId: reviews.id });
    if (!claimed) return null;

    return {
      reviewId: candidate.reviewId,
      providerProjectId: candidate.providerProjectId,
      providerOwnershipTokenHash: candidate.providerOwnershipTokenHash,
      claimantId,
      attempt,
      maxAttempts: candidate.teardownMaxAttempts,
    };
  });
}

export async function completeZeropsCleanup(
  db: TrialRunDatabase,
  claim: ZeropsCleanupClaim,
  proof: ZeropsCleanupProof,
): Promise<boolean> {
  if (!proof.deleted || proof.providerProjectId !== claim.providerProjectId) {
    throw new Error("Cleanup proof must confirm deletion of the exact claimed Zerops project.");
  }
  const [completed] = await db
    .update(reviews)
    .set({
      teardownCompletedAt: new Date(),
      teardownLockedBy: null,
      teardownLeaseExpiresAt: null,
      teardownLastError: null,
      teardownProof: {
        startedAt: proof.startedAt,
        completedAt: proof.completedAt,
        providerProjectId: proof.providerProjectId,
        deleted: proof.deleted,
        message: proof.message,
      },
    })
    .where(
      and(
        eq(reviews.id, claim.reviewId),
        eq(reviews.provider, "zerops"),
        eq(reviews.providerProjectId, claim.providerProjectId),
        eq(reviews.teardownLockedBy, claim.claimantId),
        eq(reviews.teardownAttempts, claim.attempt),
        isNull(reviews.teardownCompletedAt),
      ),
    )
    .returning({ reviewId: reviews.id });
  return Boolean(completed);
}

export async function failZeropsCleanup(
  db: TrialRunDatabase,
  claim: ZeropsCleanupClaim,
  error: string,
): Promise<ZeropsCleanupFailure | null> {
  const exhausted = claim.attempt >= claim.maxAttempts;
  const retryAt = exhausted
    ? null
    : new Date(Date.now() + Math.min(60, 2 ** claim.attempt) * 1_000);
  const [failed] = await db
    .update(reviews)
    .set({
      teardownAvailableAt: retryAt ?? new Date(),
      teardownLockedBy: null,
      teardownLeaseExpiresAt: null,
      teardownLastError: error.slice(0, 8_000),
    })
    .where(
      and(
        eq(reviews.id, claim.reviewId),
        eq(reviews.provider, "zerops"),
        eq(reviews.providerProjectId, claim.providerProjectId),
        eq(reviews.teardownLockedBy, claim.claimantId),
        eq(reviews.teardownAttempts, claim.attempt),
        isNull(reviews.teardownCompletedAt),
      ),
    )
    .returning({ reviewId: reviews.id });
  return failed ? { exhausted, retryAt } : null;
}
