import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  claimNextAgentConnectionJob,
  completeAgentConnectionJob,
  enqueueAgentConnectionJob,
  failAgentConnectionJob,
  heartbeatAgentConnectionJob,
  recoverExpiredAgentConnectionJobs,
} from "./agent-connection-queue";
import { createDatabase, type TrialRunDatabase } from "./client";
import {
  agentConnectionAuthChallenges,
  agentConnectionJobs,
  agentConnections,
  users,
} from "./schema";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://trialrun:trialrun@127.0.0.1:55432/trialrun";

const connection = createDatabase(databaseUrl, 10);
let db: TrialRunDatabase;
let ownerUserId = "";
const connectionIds: string[] = [];

async function createWorkspaceConnection() {
  const [created] = await db
    .insert(agentConnections)
    .values({
      userId: ownerUserId,
      provider: `openai-test-${randomUUID().slice(0, 8)}`,
      mode: "codex_workspace",
      status: "pending",
    })
    .returning();
  if (!created) throw new Error("Workspace connection fixture was not inserted.");
  connectionIds.push(created.id);
  return created;
}

beforeAll(async () => {
  db = connection.db;
  const [owner] = await db
    .insert(users)
    .values({
      email: `agent-connection-queue-${randomUUID()}@trialrun.test`,
      displayName: "Agent connection queue test",
      passwordHash: "not-used-in-this-integration-test",
    })
    .returning({ id: users.id });
  if (!owner) throw new Error("Agent connection queue test owner was not inserted.");
  ownerUserId = owner.id;
});

afterAll(async () => {
  if (connectionIds.length > 0) {
    await db
      .delete(agentConnectionAuthChallenges)
      .where(inArray(agentConnectionAuthChallenges.connectionId, connectionIds));
    await db
      .delete(agentConnectionJobs)
      .where(inArray(agentConnectionJobs.connectionId, connectionIds));
    await db.delete(agentConnections).where(inArray(agentConnections.id, connectionIds));
  }
  if (ownerUserId) await db.delete(users).where(eq(users.id, ownerUserId));
  await connection.close();
});

describe("durable agent connection queue", () => {
  it("allows a pending workspace without provider IDs and rejects cross-mode material", async () => {
    const workspace = await createWorkspaceConnection();
    expect(workspace.zcpProjectId).toBeNull();
    expect(workspace.zcpServiceId).toBeNull();

    await expect(
      db.insert(agentConnections).values({
        userId: ownerUserId,
        provider: `managed-${randomUUID().slice(0, 8)}`,
        mode: "managed",
        status: "connected",
        zcpProjectId: "workspace-project-not-allowed",
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(agentConnections).values({
        userId: ownerUserId,
        provider: `workspace-${randomUUID().slice(0, 8)}`,
        mode: "codex_workspace",
        status: "pending",
        ciphertext: "credential-material-not-allowed",
      }),
    ).rejects.toThrow();
  });

  it("stores only encrypted challenge material and a query-free HTTPS verification URI", async () => {
    const workspace = await createWorkspaceConnection();
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const [challenge] = await db
      .insert(agentConnectionAuthChallenges)
      .values({
        connectionId: workspace.id,
        keyVersion: 1,
        iv: "encrypted-envelope-iv",
        ciphertext: "encrypted-device-challenge",
        authTag: "encrypted-envelope-tag",
        verificationUri: "https://auth.openai.com/device",
        expiresAt,
      })
      .returning();
    expect(challenge?.ciphertext).toBe("encrypted-device-challenge");
    expect(challenge && Object.hasOwn(challenge, "userCode")).toBe(false);

    const unsafeUriWorkspace = await createWorkspaceConnection();
    await expect(
      db.insert(agentConnectionAuthChallenges).values({
        connectionId: unsafeUriWorkspace.id,
        keyVersion: 1,
        iv: "iv",
        ciphertext: "ciphertext",
        authTag: "tag",
        verificationUri: "https://auth.openai.com/device?user_code=not-allowed",
        expiresAt,
      }),
    ).rejects.toThrow();
  });

  it("allows exactly one claimant and keeps completed job history", async () => {
    const workspace = await createWorkspaceConnection();
    const first = await enqueueAgentConnectionJob(db, {
      connectionId: workspace.id,
      kind: "provision",
    });
    const duplicate = await enqueueAgentConnectionJob(db, {
      connectionId: workspace.id,
      kind: "provision",
    });
    expect(duplicate.id).toBe(first.id);
    await expect(
      enqueueAgentConnectionJob(db, { connectionId: workspace.id, kind: "authenticate" }),
    ).rejects.toThrow(/active provision job/);

    const claims = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        claimNextAgentConnectionJob(db, `agent-connection-claim-${index}`, 30),
      ),
    );
    const winners = claims.filter((claim) => claim !== null);
    expect(winners).toHaveLength(1);
    const winner = winners[0];
    if (!winner) throw new Error("No agent connection worker acquired the job.");
    expect(await heartbeatAgentConnectionJob(db, winner, 60)).toBe(true);
    expect(await completeAgentConnectionJob(db, winner)).toBe(true);
    expect(await completeAgentConnectionJob(db, winner)).toBe(false);

    const [stored] = await db
      .select()
      .from(agentConnectionJobs)
      .where(eq(agentConnectionJobs.id, first.id));
    expect(stored?.status).toBe("succeeded");
    await expect(
      db.delete(agentConnections).where(eq(agentConnections.id, workspace.id)),
    ).rejects.toThrow();
  });

  it("recovers expired leases and fences a stale claim even when the claimant ID is reused", async () => {
    const workspace = await createWorkspaceConnection();
    await enqueueAgentConnectionJob(db, {
      connectionId: workspace.id,
      kind: "authenticate",
      maxAttempts: 3,
    });
    const first = await claimNextAgentConnectionJob(db, "stable-agent-worker", 30);
    if (!first || first.connectionId !== workspace.id) {
      throw new Error("The first workspace job lease was not acquired.");
    }
    await db
      .update(agentConnectionJobs)
      .set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(agentConnectionJobs.id, first.jobId));
    expect(await recoverExpiredAgentConnectionJobs(db)).toBe(1);

    const replacement = await claimNextAgentConnectionJob(db, "stable-agent-worker", 30);
    if (!replacement) throw new Error("The recovered workspace job was not reclaimed.");
    expect(replacement).toMatchObject({ jobId: first.jobId, attempt: 2 });
    expect(await heartbeatAgentConnectionJob(db, first, 30)).toBe(false);
    expect(await completeAgentConnectionJob(db, first)).toBe(false);
    expect(await failAgentConnectionJob(db, first, "stale_worker_failed")).toBeNull();
    expect(await completeAgentConnectionJob(db, replacement)).toBe(true);
  });

  it("retries with safe error codes and stops after the bounded attempt cap", async () => {
    const workspace = await createWorkspaceConnection();
    await enqueueAgentConnectionJob(db, {
      connectionId: workspace.id,
      kind: "verify",
      maxAttempts: 2,
    });
    const first = await claimNextAgentConnectionJob(db, "verify-agent-worker", 30);
    if (!first || first.connectionId !== workspace.id) {
      throw new Error("The verification job was not claimed.");
    }
    await expect(
      failAgentConnectionJob(db, first, "raw error text is not allowed"),
    ).rejects.toThrow(/machine-readable code/);
    const firstFailure = await failAgentConnectionJob(db, first, "workspace_verify_failed");
    expect(firstFailure?.exhausted).toBe(false);
    expect(firstFailure?.retryAt?.getTime()).toBeGreaterThan(Date.now());

    const [connectionAfterFailure] = await db
      .select({ lastErrorCode: agentConnections.lastErrorCode })
      .from(agentConnections)
      .where(eq(agentConnections.id, workspace.id));
    expect(connectionAfterFailure?.lastErrorCode).toBe("workspace_verify_failed");
    await db
      .update(agentConnectionJobs)
      .set({ availableAt: new Date(Date.now() - 1_000) })
      .where(eq(agentConnectionJobs.id, first.jobId));

    const final = await claimNextAgentConnectionJob(db, "verify-agent-worker", 30);
    if (!final) throw new Error("The final verification attempt was not claimed.");
    expect(final.attempt).toBe(2);
    expect(await failAgentConnectionJob(db, final, "workspace_verify_failed")).toEqual({
      exhausted: true,
      retryAt: null,
    });
    const [stored] = await db
      .select()
      .from(agentConnectionJobs)
      .where(eq(agentConnectionJobs.id, first.jobId));
    expect(stored?.status).toBe("failed");
    expect(stored?.lastErrorCode).toBe("workspace_verify_failed");
  });
});
