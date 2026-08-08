import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyInfrastructurePolicy } from "@trialrun/domain";

import { createDatabase, type TrialRunDatabase } from "./client";
import { claimNextJob, enqueueReviewJob, recoverExpiredJobs, succeedJob } from "./queue";
import {
  githubInstallations,
  jobs,
  repositories,
  repositoryRecipes,
  reviews,
  users,
} from "./schema";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://trialrun:trialrun@127.0.0.1:55432/trialrun";

const connection = createDatabase(databaseUrl, 10);
let db: TrialRunDatabase;
let ownerUserId = "";
let repositoryId = "";
let recipeId = "";
let nextPullNumber = 1;

async function createReview(status: "queued" | "provisioning" = "queued"): Promise<string> {
  const [review] = await db
    .insert(reviews)
    .values({
      ownerUserId,
      repositoryId,
      recipeId,
      pullNumber: nextPullNumber++,
      title: `Queue integration ${randomUUID()}`,
      baseSha: "1".repeat(40),
      headSha: "2".repeat(40),
      provider: "local",
      status,
    })
    .returning({ id: reviews.id });
  if (!review) throw new Error("Test review was not inserted.");
  return review.id;
}

beforeAll(async () => {
  db = connection.db;
  const [owner] = await db
    .insert(users)
    .values({
      email: `queue-${randomUUID()}@trialrun.test`,
      displayName: "Queue test",
      passwordHash: "not-used-in-this-integration-test",
    })
    .returning({ id: users.id });
  if (!owner) throw new Error("Test owner was not inserted.");
  ownerUserId = owner.id;
  const [installation] = await db
    .insert(githubInstallations)
    .values({
      ownerUserId,
      githubInstallationId: Date.now(),
      accountId: Date.now() + 1,
      accountLogin: `queue-${randomUUID()}`,
      accountType: "User",
      repositorySelection: "selected",
    })
    .returning({ id: githubInstallations.id });
  if (!installation) throw new Error("Test installation was not inserted.");
  const [repository] = await db
    .insert(repositories)
    .values({
      installationId: installation.id,
      githubRepositoryId: Date.now() + 2,
      owner: "trialrun-test",
      name: `queue-${randomUUID()}`,
      defaultBranch: "main",
      isPrivate: true,
    })
    .returning({ id: repositories.id });
  if (!repository) throw new Error("Test repository was not inserted.");
  repositoryId = repository.id;
  const proposal = {
    schemaVersion: 1 as const,
    sourceSha: "a".repeat(40),
    summary: "A bounded queue test application.",
    applications: [{
      name: "app",
      zeropsType: "alpine/nodejs@24" as const,
      sourceRoot: ".",
      setup: "app",
      port: 3000,
      healthPath: "/health",
      testTarget: true,
      publicAccess: false,
      resources: { minCpu: 1, maxCpu: 1, minRamGb: 0.5, maxRamGb: 1, minDiskGb: 1, maxDiskGb: 2 },
      evidence: [{ path: "zerops.yaml", lineStart: 1, summary: "Test setup.", confidence: "high" as const }],
    }],
    dependencies: [],
    environmentBindings: [],
    secretBindings: [],
    unresolvedQuestions: [],
  };
  const decision = applyInfrastructurePolicy(proposal);
  if (!decision.accepted) throw new Error("Queue test recipe did not pass policy.");
  const [recipe] = await db
    .insert(repositoryRecipes)
    .values({
      repositoryId,
      version: 1,
      status: "confirmed",
      sourceSha: proposal.sourceSha,
      proposal,
      policyDecision: decision,
      approvedRecipe: decision.recipe,
      fingerprint: decision.recipe.fingerprint,
      proposedByUserId: ownerUserId,
      confirmedByUserId: ownerUserId,
      confirmedAt: new Date(),
    })
    .returning({ id: repositoryRecipes.id });
  if (!recipe) throw new Error("Test recipe was not inserted.");
  recipeId = recipe.id;
});

afterAll(async () => {
  if (ownerUserId) {
    await db.delete(reviews).where(eq(reviews.ownerUserId, ownerUserId));
    if (repositoryId) {
      await db.delete(repositoryRecipes).where(eq(repositoryRecipes.repositoryId, repositoryId));
    }
    await db.delete(users).where(eq(users.id, ownerUserId));
  }
  await connection.close();
});

describe("durable review queue", () => {
  it("allows exactly one concurrent claimant", async () => {
    const reviewId = await createReview();
    await enqueueReviewJob(db, reviewId);

    const claims = await Promise.all([
      claimNextJob(db, "queue-test-a", 90),
      claimNextJob(db, "queue-test-b", 90),
    ]);
    const claimed = claims.filter((value) => value !== null);

    expect(claimed).toHaveLength(1);
    const winner = claimed[0];
    if (!winner) throw new Error("No worker claimed the queued job.");
    await succeedJob(db, winner.job.id, winner.job.lockedBy ?? "");
  });

  it("fails an exhausted lease and requeues only a retryable lease", async () => {
    const exhaustedReviewId = await createReview("provisioning");
    const retryableReviewId = await createReview("provisioning");
    const expiredAt = new Date(Date.now() - 60_000);
    const [exhausted, retryable] = await db
      .insert(jobs)
      .values([
        {
          reviewId: exhaustedReviewId,
          kind: "run_review",
          status: "running",
          attempts: 3,
          maxAttempts: 3,
          leaseExpiresAt: expiredAt,
          lockedBy: "dead-runner-a",
        },
        {
          reviewId: retryableReviewId,
          kind: "run_review",
          status: "running",
          attempts: 1,
          maxAttempts: 3,
          leaseExpiresAt: expiredAt,
          lockedBy: "dead-runner-b",
        },
      ])
      .returning({ id: jobs.id });
    if (!exhausted || !retryable) throw new Error("Lease fixtures were not inserted.");

    expect(await recoverExpiredJobs(db)).toBe(2);
    const [exhaustedAfter] = await db.select().from(jobs).where(eq(jobs.id, exhausted.id)).limit(1);
    const [retryableAfter] = await db.select().from(jobs).where(eq(jobs.id, retryable.id)).limit(1);

    expect(exhaustedAfter?.status).toBe("failed");
    expect(retryableAfter?.status).toBe("failed");
    expect(retryableAfter?.lockedBy).toBeNull();
    const [exhaustedReview] = await db.select().from(reviews).where(eq(reviews.id, exhaustedReviewId));
    const [retryableReview] = await db.select().from(reviews).where(eq(reviews.id, retryableReviewId));
    expect(exhaustedReview?.status).toBe("inconclusive");
    expect(retryableReview?.status).toBe("inconclusive");
  });

  it("refuses to execute a stale job for an already-started review", async () => {
    const reviewId = await createReview("provisioning");
    await enqueueReviewJob(db, reviewId);

    expect(await claimNextJob(db, "queue-test-stale", 90)).toBeNull();
    const [job] = await db.select().from(jobs).where(eq(jobs.reviewId, reviewId)).limit(1);
    expect(job?.status).toBe("failed");
    expect(job?.lastError).toContain("stale job");
  });
});
