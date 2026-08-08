import { and, asc, eq, lt, lte, sql } from "drizzle-orm";

import type { TrialRunDatabase } from "./client";
import {
  githubInstallations,
  repositories,
  repositoryAnalysisJobs,
  type RepositoryAnalysisJob,
} from "./schema";

export interface ClaimedRepositoryAnalysis {
  readonly job: RepositoryAnalysisJob;
  readonly repository: typeof repositories.$inferSelect;
  readonly installation: typeof githubInstallations.$inferSelect;
}

export async function enqueueRepositoryAnalysis(
  db: TrialRunDatabase,
  input: { readonly repositoryId: string; readonly requestedByUserId: string; readonly sourceSha: string },
): Promise<RepositoryAnalysisJob> {
  return db.transaction(async (tx) => {
    const [repository] = await tx
      .select({ id: repositories.id })
      .from(repositories)
      .innerJoin(
        githubInstallations,
        and(
          eq(repositories.installationId, githubInstallations.id),
          eq(githubInstallations.ownerUserId, input.requestedByUserId),
        ),
      )
      .where(and(eq(repositories.id, input.repositoryId), eq(repositories.isActive, true)))
      .limit(1)
      .for("update");
    if (!repository) throw new Error("Repository is not connected to this account.");
    const [existing] = await tx
      .select()
      .from(repositoryAnalysisJobs)
      .where(
        and(
          eq(repositoryAnalysisJobs.repositoryId, repository.id),
          sql`${repositoryAnalysisJobs.status} in ('queued', 'running')`,
        ),
      )
      .limit(1);
    if (existing) return existing;
    const [created] = await tx
      .insert(repositoryAnalysisJobs)
      .values({
        repositoryId: repository.id,
        requestedByUserId: input.requestedByUserId,
        sourceSha: input.sourceSha,
      })
      .returning();
    if (!created) throw new Error("Repository analysis was not enqueued.");
    return created;
  });
}

export async function claimNextRepositoryAnalysis(
  db: TrialRunDatabase,
  runnerId: string,
  leaseSeconds: number,
): Promise<ClaimedRepositoryAnalysis | null> {
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select()
      .from(repositoryAnalysisJobs)
      .where(
        and(
          eq(repositoryAnalysisJobs.status, "queued"),
          lte(repositoryAnalysisJobs.availableAt, new Date()),
          sql`${repositoryAnalysisJobs.attempts} < ${repositoryAnalysisJobs.maxAttempts}`,
        ),
      )
      .orderBy(asc(repositoryAnalysisJobs.availableAt), asc(repositoryAnalysisJobs.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate) return null;
    const [source] = await tx
      .select({ repository: repositories, installation: githubInstallations })
      .from(repositories)
      .innerJoin(githubInstallations, eq(repositories.installationId, githubInstallations.id))
      .where(eq(repositories.id, candidate.repositoryId))
      .limit(1);
    if (!source || !source.repository.isActive || source.installation.suspendedAt) {
      await tx
        .update(repositoryAnalysisJobs)
        .set({ status: "failed", lastError: "GitHub installation or repository is unavailable." })
        .where(eq(repositoryAnalysisJobs.id, candidate.id));
      return null;
    }
    const [claimed] = await tx
      .update(repositoryAnalysisJobs)
      .set({
        status: "running",
        attempts: candidate.attempts + 1,
        lockedBy: runnerId,
        leaseExpiresAt: new Date(Date.now() + leaseSeconds * 1_000),
      })
      .where(
        and(
          eq(repositoryAnalysisJobs.id, candidate.id),
          eq(repositoryAnalysisJobs.status, "queued"),
        ),
      )
      .returning();
    return claimed ? { job: claimed, ...source } : null;
  });
}

export async function heartbeatRepositoryAnalysis(
  db: TrialRunDatabase,
  jobId: string,
  runnerId: string,
  leaseSeconds: number,
): Promise<boolean> {
  const [updated] = await db
    .update(repositoryAnalysisJobs)
    .set({ leaseExpiresAt: new Date(Date.now() + leaseSeconds * 1_000) })
    .where(
      and(
        eq(repositoryAnalysisJobs.id, jobId),
        eq(repositoryAnalysisJobs.status, "running"),
        eq(repositoryAnalysisJobs.lockedBy, runnerId),
      ),
    )
    .returning({ id: repositoryAnalysisJobs.id });
  return Boolean(updated);
}

export async function succeedRepositoryAnalysis(
  db: TrialRunDatabase,
  jobId: string,
  runnerId: string,
  recipeId: string,
): Promise<void> {
  const [updated] = await db
    .update(repositoryAnalysisJobs)
    .set({
      status: "succeeded",
      recipeId,
      leaseExpiresAt: null,
      lockedBy: null,
      lastError: null,
    })
    .where(
      and(
        eq(repositoryAnalysisJobs.id, jobId),
        eq(repositoryAnalysisJobs.status, "running"),
        eq(repositoryAnalysisJobs.lockedBy, runnerId),
      ),
    )
    .returning({ id: repositoryAnalysisJobs.id });
  if (!updated) throw new Error("Runner no longer owns the repository analysis job.");
}

export async function failRepositoryAnalysis(
  db: TrialRunDatabase,
  job: RepositoryAnalysisJob,
  runnerId: string,
  error: string,
): Promise<void> {
  const retry = job.attempts < job.maxAttempts;
  await db
    .update(repositoryAnalysisJobs)
    .set({
      status: retry ? "queued" : "failed",
      availableAt: retry
        ? new Date(Date.now() + Math.min(60, 2 ** job.attempts) * 1_000)
        : job.availableAt,
      leaseExpiresAt: null,
      lockedBy: null,
      lastError: error.slice(0, 8_000),
    })
    .where(
      and(
        eq(repositoryAnalysisJobs.id, job.id),
        eq(repositoryAnalysisJobs.status, "running"),
        eq(repositoryAnalysisJobs.lockedBy, runnerId),
      ),
    );
}

export async function recoverExpiredRepositoryAnalyses(db: TrialRunDatabase): Promise<number> {
  const result = await db
    .update(repositoryAnalysisJobs)
    .set({
      status: "queued",
      availableAt: new Date(),
      leaseExpiresAt: null,
      lockedBy: null,
      lastError: "Runner lease expired; bounded analysis will be retried.",
    })
    .where(
      and(
        eq(repositoryAnalysisJobs.status, "running"),
        lt(repositoryAnalysisJobs.leaseExpiresAt, new Date()),
        sql`${repositoryAnalysisJobs.attempts} < ${repositoryAnalysisJobs.maxAttempts}`,
      ),
    )
    .returning({ id: repositoryAnalysisJobs.id });
  return result.length;
}
