import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  claimNextRepositoryAnalysis,
  enqueueRepositoryAnalysis,
  recoverExpiredRepositoryAnalyses,
} from "./analysis-queue";
import { createDatabase, type TrialRunDatabase } from "./client";
import {
  agentConnections,
  githubInstallations,
  repositories,
  repositoryAnalysisJobs,
  users,
} from "./schema";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://trialrun:trialrun@127.0.0.1:55432/trialrun";

const connection = createDatabase(databaseUrl, 10);
let db: TrialRunDatabase;
let ownerUserId = "";
let otherUserId = "";
let installationId = "";
let ownerConnectionId = "";
let otherConnectionId = "";

function remoteId(): number {
  return Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16);
}

async function createRepository(): Promise<string> {
  const [repository] = await db
    .insert(repositories)
    .values({
      installationId,
      githubRepositoryId: remoteId(),
      owner: "trialrun-analysis-test",
      name: `analysis-${randomUUID()}`,
      defaultBranch: "main",
      isPrivate: true,
    })
    .returning({ id: repositories.id });
  if (!repository) throw new Error("Analysis queue test repository was not inserted.");
  return repository.id;
}

async function enqueue(repositoryId: string, sourceSha = "a".repeat(40)) {
  return enqueueRepositoryAnalysis(db, {
    repositoryId,
    requestedByUserId: ownerUserId,
    agentConnectionId: ownerConnectionId,
    sourceSha,
  });
}

async function terminalize(jobId: string): Promise<void> {
  await db
    .update(repositoryAnalysisJobs)
    .set({ status: "failed", lockedBy: null, leaseExpiresAt: null })
    .where(eq(repositoryAnalysisJobs.id, jobId));
}

beforeAll(async () => {
  db = connection.db;
  const [owner, other] = await db
    .insert(users)
    .values([
      {
        email: `analysis-owner-${randomUUID()}@trialrun.test`,
        displayName: "Analysis owner",
        passwordHash: "not-used-in-this-integration-test",
      },
      {
        email: `analysis-other-${randomUUID()}@trialrun.test`,
        displayName: "Other analysis user",
        passwordHash: "not-used-in-this-integration-test",
      },
    ])
    .returning({ id: users.id });
  if (!owner || !other) throw new Error("Analysis queue test users were not inserted.");
  ownerUserId = owner.id;
  otherUserId = other.id;

  const [installation] = await db
    .insert(githubInstallations)
    .values({
      ownerUserId,
      githubInstallationId: remoteId(),
      accountId: remoteId(),
      accountLogin: `analysis-${randomUUID()}`,
      accountType: "User",
      repositorySelection: "selected",
    })
    .returning({ id: githubInstallations.id });
  if (!installation) throw new Error("Analysis queue test installation was not inserted.");
  installationId = installation.id;

  const [ownerConnection, otherConnection] = await db
    .insert(agentConnections)
    .values([
      { userId: ownerUserId, provider: "openai", mode: "managed", status: "connected" },
      { userId: otherUserId, provider: "openai", mode: "managed", status: "connected" },
    ])
    .returning({ id: agentConnections.id });
  if (!ownerConnection || !otherConnection) {
    throw new Error("Analysis queue test connections were not inserted.");
  }
  ownerConnectionId = ownerConnection.id;
  otherConnectionId = otherConnection.id;
});

afterAll(async () => {
  if (installationId) {
    await db.delete(githubInstallations).where(eq(githubInstallations.id, installationId));
  }
  if (ownerConnectionId) {
    await db.delete(agentConnections).where(eq(agentConnections.id, ownerConnectionId));
  }
  if (otherConnectionId) {
    await db.delete(agentConnections).where(eq(agentConnections.id, otherConnectionId));
  }
  if (ownerUserId) await db.delete(users).where(eq(users.id, ownerUserId));
  if (otherUserId) await db.delete(users).where(eq(users.id, otherUserId));
  await connection.close();
});

describe("repository analysis connection pinning", () => {
  it("requires a connected OpenAI connection owned by the repository account", async () => {
    const repositoryId = await createRepository();
    await expect(
      enqueueRepositoryAnalysis(db, {
        repositoryId,
        requestedByUserId: ownerUserId,
        agentConnectionId: otherConnectionId,
        sourceSha: "a".repeat(40),
      }),
    ).rejects.toThrow(/not connected to this account/);

    const job = await enqueue(repositoryId);
    expect(job.agentConnectionId).toBe(ownerConnectionId);
    expect((await enqueue(repositoryId)).id).toBe(job.id);
    await expect(enqueue(repositoryId, "b".repeat(40))).rejects.toThrow(/different source commit/);
    await terminalize(job.id);
  });

  it("allows nullable pins only on terminal legacy history", async () => {
    const repositoryId = await createRepository();
    await expect(
      db.insert(repositoryAnalysisJobs).values({
        repositoryId,
        requestedByUserId: ownerUserId,
        sourceSha: "c".repeat(40),
      }),
    ).rejects.toThrow();

    const [legacy] = await db
      .insert(repositoryAnalysisJobs)
      .values({
        repositoryId,
        requestedByUserId: ownerUserId,
        sourceSha: "c".repeat(40),
        status: "failed",
        lastError: "Legacy job predates exact connection pinning.",
      })
      .returning();
    expect(legacy?.agentConnectionId).toBeNull();
  });

  it("returns the exact owned connection to exactly one concurrent claimant", async () => {
    const repositoryId = await createRepository();
    const job = await enqueue(repositoryId);
    const claims = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        claimNextRepositoryAnalysis(db, `analysis-claim-${index}`, 30),
      ),
    );
    const winners = claims.filter((claim) => claim !== null);
    expect(winners).toHaveLength(1);
    const winner = winners[0];
    if (!winner) throw new Error("No runner claimed the repository analysis job.");
    expect(winner.job.id).toBe(job.id);
    expect(winner.job.agentConnectionId).toBe(ownerConnectionId);
    expect(winner.agentConnectionId).toBe(ownerConnectionId);
    await terminalize(job.id);
  });

  it("preserves the pin across lease recovery and a repeated claimant ID", async () => {
    const repositoryId = await createRepository();
    const job = await enqueue(repositoryId);
    const first = await claimNextRepositoryAnalysis(db, "stable-analysis-runner", 30);
    if (!first || first.job.id !== job.id) {
      throw new Error("The first repository analysis lease was not acquired.");
    }
    await db
      .update(repositoryAnalysisJobs)
      .set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(repositoryAnalysisJobs.id, job.id));
    expect(await recoverExpiredRepositoryAnalyses(db)).toBe(1);

    const replacement = await claimNextRepositoryAnalysis(db, "stable-analysis-runner", 30);
    if (!replacement) throw new Error("The recovered analysis job was not reclaimed.");
    expect(replacement.job.attempts).toBe(2);
    expect(replacement.job.agentConnectionId).toBe(ownerConnectionId);
    expect(replacement.agentConnectionId).toBe(ownerConnectionId);
    await terminalize(job.id);
  });

  it("keeps historical pins and refuses to claim a disconnected selection", async () => {
    const repositoryId = await createRepository();
    const job = await enqueue(repositoryId);
    await db
      .update(agentConnections)
      .set({ status: "revoked", revokedAt: new Date() })
      .where(eq(agentConnections.id, ownerConnectionId));

    expect(await claimNextRepositoryAnalysis(db, "analysis-disconnected", 30)).toBeNull();
    const [stored] = await db
      .select()
      .from(repositoryAnalysisJobs)
      .where(eq(repositoryAnalysisJobs.id, job.id));
    expect(stored?.status).toBe("failed");
    expect(stored?.agentConnectionId).toBe(ownerConnectionId);
    await expect(
      db.delete(agentConnections).where(eq(agentConnections.id, ownerConnectionId)),
    ).rejects.toThrow();

    await db
      .update(agentConnections)
      .set({ status: "connected", revokedAt: null })
      .where(eq(agentConnections.id, ownerConnectionId));
  });
});
