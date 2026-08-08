import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyInfrastructurePolicy } from "@trialrun/domain";

import {
  claimNextZeropsCleanup,
  completeZeropsCleanup,
  failZeropsCleanup,
  type ZeropsCleanupClaim,
  type ZeropsCleanupProof,
} from "./cleanup";
import { createDatabase, type TrialRunDatabase } from "./client";
import { githubInstallations, repositories, repositoryRecipes, reviews, users } from "./schema";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://trialrun:trialrun@127.0.0.1:55432/trialrun";

const connection = createDatabase(databaseUrl, 10);
let db: TrialRunDatabase;
let ownerUserId = "";
let repositoryId = "";
let recipeId = "";
let nextPullNumber = 10_000;

function remoteId(): number {
  return Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16);
}

async function createReview(
  input: {
    readonly status?: "queued" | "tearing_down" | "completed" | "inconclusive" | "cancelled";
    readonly provider?: "local" | "zerops";
    readonly providerProjectId?: string | null;
    readonly providerOwnershipTokenHash?: string | null;
    readonly teardownCompletedAt?: Date | null;
    readonly teardownAttempts?: number;
    readonly teardownMaxAttempts?: number;
    readonly teardownAvailableAt?: Date;
    readonly teardownLockedBy?: string | null;
    readonly teardownLeaseExpiresAt?: Date | null;
  } = {},
): Promise<typeof reviews.$inferSelect> {
  const providerProjectId = Object.hasOwn(input, "providerProjectId")
    ? input.providerProjectId
    : `zerops-project-${randomUUID()}`;
  const [review] = await db
    .insert(reviews)
    .values({
      ownerUserId,
      repositoryId,
      recipeId,
      pullNumber: nextPullNumber++,
      title: `Cleanup integration ${randomUUID()}`,
      baseSha: "1".repeat(40),
      headSha: "2".repeat(40),
      provider: input.provider ?? "zerops",
      providerProjectId,
      providerOwnershipTokenHash: input.providerOwnershipTokenHash,
      status: input.status ?? "completed",
      teardownCompletedAt: input.teardownCompletedAt,
      teardownAttempts: input.teardownAttempts,
      teardownMaxAttempts: input.teardownMaxAttempts,
      teardownAvailableAt: input.teardownAvailableAt ?? new Date(Date.now() - 60_000),
      teardownLockedBy: input.teardownLockedBy,
      teardownLeaseExpiresAt: input.teardownLeaseExpiresAt,
    })
    .returning();
  if (!review) throw new Error("Cleanup test review was not inserted.");
  return review;
}

function proofFor(projectId: string): ZeropsCleanupProof {
  const now = new Date().toISOString();
  return {
    startedAt: now,
    completedAt: now,
    providerProjectId: projectId,
    deleted: true,
    message: "The exact Zerops project is absent.",
  };
}

async function completeClaim(claim: ZeropsCleanupClaim): Promise<void> {
  expect(await completeZeropsCleanup(db, claim, proofFor(claim.providerProjectId))).toBe(true);
}

beforeAll(async () => {
  db = connection.db;
  const [owner] = await db
    .insert(users)
    .values({
      email: `cleanup-${randomUUID()}@trialrun.test`,
      displayName: "Cleanup test",
      passwordHash: "not-used-in-this-integration-test",
    })
    .returning({ id: users.id });
  if (!owner) throw new Error("Cleanup test owner was not inserted.");
  ownerUserId = owner.id;
  const [installation] = await db
    .insert(githubInstallations)
    .values({
      ownerUserId,
      githubInstallationId: remoteId(),
      accountId: remoteId(),
      accountLogin: `cleanup-${randomUUID()}`,
      accountType: "User",
      repositorySelection: "selected",
    })
    .returning({ id: githubInstallations.id });
  if (!installation) throw new Error("Cleanup test installation was not inserted.");
  const [repository] = await db
    .insert(repositories)
    .values({
      installationId: installation.id,
      githubRepositoryId: remoteId(),
      owner: "trialrun-test",
      name: `cleanup-${randomUUID()}`,
      defaultBranch: "main",
      isPrivate: true,
    })
    .returning({ id: repositories.id });
  if (!repository) throw new Error("Cleanup test repository was not inserted.");
  repositoryId = repository.id;
  const proposal = {
    schemaVersion: 1 as const,
    sourceSha: "a".repeat(40),
    summary: "A bounded cleanup test application.",
    applications: [
      {
        name: "app",
        zeropsType: "alpine/nodejs@24" as const,
        sourceRoot: ".",
        setup: "app",
        port: 3000,
        healthPath: "/health",
        build: {
          base: "alpine/nodejs@24" as const,
          buildCommands: ["npm ci", "npm run build"],
          deployFiles: ["dist", "package.json"],
        },
        run: { start: "node dist/server.js" },
        testTarget: true,
        publicAccess: false,
        resources: {
          minCpu: 1,
          maxCpu: 1,
          minRamGb: 0.5,
          maxRamGb: 1,
          minDiskGb: 1,
          maxDiskGb: 2,
        },
        evidence: [
          {
            path: "zerops.yaml",
            lineStart: 1,
            lineEnd: 1,
            summary: "Test setup.",
            confidence: "high" as const,
          },
        ],
      },
    ],
    dependencies: [],
    environmentBindings: [],
    secretBindings: [],
    unresolvedQuestions: [],
  };
  const decision = applyInfrastructurePolicy(proposal);
  if (!decision.accepted) throw new Error("Cleanup test recipe did not pass policy.");
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
  if (!recipe) throw new Error("Cleanup test recipe was not inserted.");
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

describe("exact-ID Zerops cleanup queue", () => {
  it("claims only due terminal Zerops reviews with a persisted exact project ID", async () => {
    const ownershipTokenHash = "a".repeat(64);
    const eligible = await createReview({ providerOwnershipTokenHash: ownershipTokenHash });
    await createReview({ provider: "local" });
    await createReview({ providerProjectId: null });
    await createReview({ status: "tearing_down" });
    await createReview({ teardownCompletedAt: new Date() });
    await createReview({ teardownAvailableAt: new Date(Date.now() + 3_600_000) });
    await createReview({
      teardownLockedBy: "active-cleaner",
      teardownLeaseExpiresAt: new Date(Date.now() + 3_600_000),
    });
    await createReview({ teardownAttempts: 2, teardownMaxAttempts: 2 });

    const claim = await claimNextZeropsCleanup(db, "cleanup-eligibility", 30);

    expect(claim?.reviewId).toBe(eligible.id);
    expect(claim?.providerProjectId).toBe(eligible.providerProjectId);
    expect(claim?.providerOwnershipTokenHash).toBe(ownershipTokenHash);
    if (!claim) throw new Error("The eligible cleanup review was not claimed.");
    await completeClaim(claim);
  });

  it("allows exactly one concurrent claim for an inconclusive review", async () => {
    const review = await createReview({ status: "inconclusive" });
    const claims = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        claimNextZeropsCleanup(db, `cleanup-concurrent-${index}`, 30),
      ),
    );
    const winners = claims.filter((claim) => claim !== null);

    expect(winners).toHaveLength(1);
    expect(winners[0]?.reviewId).toBe(review.id);
    const winner = winners[0];
    if (!winner) throw new Error("No cleanup worker acquired the review.");
    await completeClaim(winner);
  });

  it("recovers an expired lease and fences every stale claim field", async () => {
    const review = await createReview({ status: "cancelled" });
    const first = await claimNextZeropsCleanup(db, "stable-cleanup-worker", 30);
    if (!first || first.reviewId !== review.id) {
      throw new Error("The first cleanup lease was not acquired.");
    }
    await db
      .update(reviews)
      .set({ teardownLeaseExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(reviews.id, review.id));
    const replacement = await claimNextZeropsCleanup(db, "stable-cleanup-worker", 30);
    if (!replacement) throw new Error("The expired cleanup lease was not recovered.");
    expect(replacement).toMatchObject({ reviewId: review.id, attempt: 2 });

    expect(await completeZeropsCleanup(db, first, proofFor(first.providerProjectId))).toBe(false);
    expect(await failZeropsCleanup(db, first, "late stale failure")).toBeNull();
    await expect(
      completeZeropsCleanup(db, replacement, proofFor("different-project-id")),
    ).rejects.toThrow("exact claimed Zerops project");
    const wrongProject = { ...replacement, providerProjectId: "different-project-id" };
    expect(
      await completeZeropsCleanup(db, wrongProject, proofFor(wrongProject.providerProjectId)),
    ).toBe(false);
    expect(await failZeropsCleanup(db, wrongProject, "wrong project")).toBeNull();
    const wrongClaimant = { ...replacement, claimantId: "different-cleanup-worker" };
    expect(
      await completeZeropsCleanup(db, wrongClaimant, proofFor(wrongClaimant.providerProjectId)),
    ).toBe(false);
    const wrongReview = { ...replacement, reviewId: randomUUID() };
    expect(
      await completeZeropsCleanup(db, wrongReview, proofFor(wrongReview.providerProjectId)),
    ).toBe(false);

    const proof = proofFor(replacement.providerProjectId);
    expect(await completeZeropsCleanup(db, replacement, proof)).toBe(true);
    const [stored] = await db.select().from(reviews).where(eq(reviews.id, review.id));
    expect(stored?.teardownCompletedAt).toBeInstanceOf(Date);
    expect(stored?.teardownProof).toEqual(proof);
  });

  it("stores bounded errors and exponential backoff until attempts are exhausted", async () => {
    const review = await createReview({ status: "cancelled", teardownMaxAttempts: 2 });
    const first = await claimNextZeropsCleanup(db, "cleanup-retry-a", 30);
    if (!first || first.reviewId !== review.id) {
      throw new Error("The retryable cleanup review was not claimed.");
    }
    const firstFailure = await failZeropsCleanup(db, first, "x".repeat(9_000));
    expect(firstFailure?.exhausted).toBe(false);
    expect(firstFailure?.retryAt?.getTime()).toBeGreaterThan(Date.now());
    const [afterFirstFailure] = await db.select().from(reviews).where(eq(reviews.id, review.id));
    expect(afterFirstFailure?.teardownLastError).toHaveLength(8_000);
    expect(afterFirstFailure?.teardownLockedBy).toBeNull();
    expect(await claimNextZeropsCleanup(db, "cleanup-too-early", 30)).toBeNull();

    await db
      .update(reviews)
      .set({ teardownAvailableAt: new Date(Date.now() - 1_000) })
      .where(eq(reviews.id, review.id));
    const final = await claimNextZeropsCleanup(db, "cleanup-retry-b", 30);
    if (!final) throw new Error("The final cleanup attempt was not claimed.");
    expect(final.attempt).toBe(2);
    expect(await failZeropsCleanup(db, final, "still present")).toEqual({
      exhausted: true,
      retryAt: null,
    });
    expect(await claimNextZeropsCleanup(db, "cleanup-over-cap", 30)).toBeNull();
  });
});
