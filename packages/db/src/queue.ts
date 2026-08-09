import { and, asc, eq, inArray, lt, lte, notInArray, sql } from "drizzle-orm";

import type { ReviewStatus } from "@trialrun/domain";
import { canTransitionReview } from "@trialrun/domain";

import type { TrialRunDatabase } from "./client";
import { jobs, reviewEvents, reviews, type Job } from "./schema";

export interface ClaimedJob {
  readonly job: Job;
  readonly review: typeof reviews.$inferSelect;
}

export async function enqueueReviewJob(db: TrialRunDatabase, reviewId: string): Promise<void> {
  await db.insert(jobs).values({ reviewId, kind: "run_review" });
}

export async function claimNextJob(
  db: TrialRunDatabase,
  runnerId: string,
  leaseSeconds: number,
): Promise<ClaimedJob | null> {
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.status, "queued"),
          lte(jobs.availableAt, new Date()),
          sql`${jobs.attempts} < ${jobs.maxAttempts}`,
        ),
      )
      .orderBy(asc(jobs.availableAt), asc(jobs.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });

    if (!candidate) {
      return null;
    }

    const [review] = await tx
      .select()
      .from(reviews)
      .where(eq(reviews.id, candidate.reviewId))
      .limit(1)
      .for("update");
    if (!review) {
      throw new Error(`Review ${candidate.reviewId} for job ${candidate.id} does not exist.`);
    }
    if (review.status !== "queued") {
      await tx
        .update(jobs)
        .set({
          status: "failed",
          lastError: `Review is already ${review.status}; stale job was not executed.`,
        })
        .where(eq(jobs.id, candidate.id));
      return null;
    }

    const leaseExpiresAt = new Date(Date.now() + leaseSeconds * 1_000);
    const [claimed] = await tx
      .update(jobs)
      .set({
        status: "running",
        lockedBy: runnerId,
        leaseExpiresAt,
        attempts: candidate.attempts + 1,
      })
      .where(and(eq(jobs.id, candidate.id), eq(jobs.status, "queued")))
      .returning();

    if (!claimed) {
      return null;
    }

    return { job: claimed, review };
  });
}

export async function heartbeatJob(
  db: TrialRunDatabase,
  jobId: string,
  runnerId: string,
  leaseSeconds: number,
): Promise<boolean> {
  const [job] = await db
    .update(jobs)
    .set({ leaseExpiresAt: new Date(Date.now() + leaseSeconds * 1_000) })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, "running"), eq(jobs.lockedBy, runnerId)))
    .returning({ id: jobs.id });
  return Boolean(job);
}

export async function isReviewCancellationRequested(
  db: TrialRunDatabase,
  reviewId: string,
): Promise<boolean> {
  const [review] = await db
    .select({ cancelRequestedAt: reviews.cancelRequestedAt })
    .from(reviews)
    .where(eq(reviews.id, reviewId))
    .limit(1);
  if (!review) throw new Error(`Review ${reviewId} does not exist.`);
  return review.cancelRequestedAt !== null;
}

export async function requestReviewCancellation(
  db: TrialRunDatabase,
  reviewId: string,
  message: string,
): Promise<boolean> {
  const [review] = await db
    .update(reviews)
    .set({ cancelRequestedAt: new Date(), statusMessage: message })
    .where(
      and(
        eq(reviews.id, reviewId),
        notInArray(reviews.status, ["completed", "inconclusive", "cancelled"]),
      ),
    )
    .returning({ id: reviews.id });
  return Boolean(review);
}

export async function succeedJob(db: TrialRunDatabase, jobId: string, runnerId: string): Promise<void> {
  const [succeeded] = await db
    .update(jobs)
    .set({ status: "succeeded", leaseExpiresAt: null, lockedBy: null })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, "running"), eq(jobs.lockedBy, runnerId)))
    .returning({ id: jobs.id });
  if (!succeeded) throw new Error("Runner no longer owns the job it tried to complete.");
}

export async function failJob(
  db: TrialRunDatabase,
  job: Job,
  runnerId: string,
  error: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [review] = await tx
      .select({ status: reviews.status, cancelRequestedAt: reviews.cancelRequestedAt })
      .from(reviews)
      .where(eq(reviews.id, job.reviewId))
      .limit(1)
      .for("update");
    const retry =
      review?.status === "queued" &&
      review.cancelRequestedAt === null &&
      job.attempts < job.maxAttempts;
    await tx
      .update(jobs)
      .set({
        status: retry ? "queued" : "failed",
        availableAt: retry
          ? new Date(Date.now() + Math.min(60, 2 ** job.attempts) * 1_000)
          : job.availableAt,
        leaseExpiresAt: null,
        lockedBy: null,
        lastError: error.slice(0, 8_000),
      })
      .where(and(eq(jobs.id, job.id), eq(jobs.status, "running"), eq(jobs.lockedBy, runnerId)));
    if (
      review &&
      !retry &&
      !["completed", "inconclusive", "cancelled"].includes(review.status)
    ) {
      const cancelled = review.cancelRequestedAt !== null;
      const terminalStatus = cancelled ? "cancelled" : "inconclusive";
      const terminalMessage = cancelled
        ? "Review cancelled after the runner stopped; cleanup reconciliation is required."
        : "Runner failed after work began; cleanup reconciliation is required.";
      await tx
        .update(reviews)
        .set({
          status: terminalStatus,
          verdict: "inconclusive",
          statusMessage: terminalMessage,
          completedAt: new Date(),
        })
        .where(eq(reviews.id, job.reviewId));
      await tx.insert(reviewEvents).values({
        reviewId: job.reviewId,
        type: `status.${terminalStatus}`,
        message: terminalMessage,
        payload: { jobId: job.id },
      });
    }
  });
}

export async function recoverExpiredJobs(db: TrialRunDatabase): Promise<number> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const expired = await tx
      .select({ id: jobs.id, reviewId: jobs.reviewId })
      .from(jobs)
      .where(and(eq(jobs.status, "running"), lt(jobs.leaseExpiresAt, now)))
      .orderBy(asc(jobs.leaseExpiresAt))
      .limit(100)
      .for("update", { skipLocked: true });
    if (expired.length === 0) return 0;

    const jobIds = expired.map(({ id }) => id);
    const reviewIds = [...new Set(expired.map(({ reviewId }) => reviewId))];
    const affectedReviews = await tx
      .select({
        id: reviews.id,
        status: reviews.status,
        cancelRequestedAt: reviews.cancelRequestedAt,
      })
      .from(reviews)
      .where(inArray(reviews.id, reviewIds))
      .for("update");
    const terminalizable = affectedReviews.filter(
      ({ status }) => !["completed", "inconclusive", "cancelled"].includes(status),
    );
    const cancelledReviewIds = terminalizable
      .filter(({ cancelRequestedAt }) => cancelRequestedAt !== null)
      .map(({ id }) => id);
    const inconclusiveReviewIds = terminalizable
      .filter(({ cancelRequestedAt }) => cancelRequestedAt === null)
      .map(({ id }) => id);
    await tx
      .update(jobs)
      .set({
        status: "failed",
        leaseExpiresAt: null,
        lockedBy: null,
        lastError: "Runner lease expired after work may have begun; automatic replay is unsafe.",
      })
      .where(inArray(jobs.id, jobIds));
    if (inconclusiveReviewIds.length > 0) {
      await tx
        .update(reviews)
        .set({
          status: "inconclusive",
          verdict: "inconclusive",
          statusMessage: "Runner lease expired; cleanup reconciliation is required.",
          completedAt: now,
        })
        .where(inArray(reviews.id, inconclusiveReviewIds));
    }
    if (cancelledReviewIds.length > 0) {
      await tx
        .update(reviews)
        .set({
          status: "cancelled",
          verdict: "inconclusive",
          statusMessage: "Review cancellation was preserved after the runner lease expired.",
          completedAt: now,
        })
        .where(inArray(reviews.id, cancelledReviewIds));
    }
    if (terminalizable.length > 0) {
      await tx.insert(reviewEvents).values(
        terminalizable.map(({ id: reviewId, cancelRequestedAt }) => ({
          reviewId,
          type: "runner.lease_expired",
          message:
            cancelRequestedAt === null
              ? "Runner lease expired; automatic replay was refused and cleanup reconciliation is required."
              : "Runner lease expired after cancellation; cancellation intent was preserved and cleanup reconciliation is required.",
          payload: {},
        })),
      );
    }
    return expired.length;
  });
}

export async function appendReviewEvent(
  db: TrialRunDatabase,
  reviewId: string,
  type: string,
  message: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await db.insert(reviewEvents).values({ reviewId, type, message, payload });
}

export async function transitionReview(
  db: TrialRunDatabase,
  reviewId: string,
  to: ReviewStatus,
  message: string,
): Promise<ReviewStatus> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: reviews.status, cancelRequestedAt: reviews.cancelRequestedAt })
      .from(reviews)
      .where(eq(reviews.id, reviewId))
      .limit(1)
      .for("update");
    if (!current) {
      throw new Error(`Review ${reviewId} does not exist.`);
    }
    if (!canTransitionReview(current.status, to)) {
      throw new Error(`Invalid review transition: ${current.status} -> ${to}.`);
    }
    const actualStatus =
      current.cancelRequestedAt && (to === "completed" || to === "inconclusive")
        ? ("cancelled" as const)
        : to;
    const actualMessage =
      actualStatus === "cancelled" && to !== "cancelled"
        ? "Review cancelled after evidence preservation and cleanup"
        : message;
    await tx
      .update(reviews)
      .set({
        status: actualStatus,
        statusMessage: actualMessage,
        verdict: actualStatus === "cancelled" ? "inconclusive" : undefined,
        startedAt: current.status === "queued" ? new Date() : undefined,
        completedAt: ["completed", "inconclusive", "cancelled"].includes(actualStatus)
          ? new Date()
          : undefined,
      })
      .where(eq(reviews.id, reviewId));
    await tx.insert(reviewEvents).values({
      reviewId,
      type: `status.${actualStatus}`,
      message: actualMessage,
      payload: {},
    });
    return actualStatus;
  });
}
