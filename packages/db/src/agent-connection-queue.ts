import { and, asc, eq, inArray, lt, lte, sql } from "drizzle-orm";

import type { TrialRunDatabase } from "./client";
import {
  agentConnectionJobs,
  agentConnections,
  type AgentConnection,
  type AgentConnectionJob,
} from "./schema";

const errorCodePattern = /^[a-z0-9][a-z0-9._-]{0,79}$/;

export type AgentConnectionJobKind = AgentConnectionJob["kind"];

export interface AgentConnectionJobClaim {
  readonly jobId: string;
  readonly connectionId: string;
  readonly kind: AgentConnectionJobKind;
  readonly claimantId: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly connection: AgentConnection;
}

export interface AgentConnectionJobFailure {
  readonly exhausted: boolean;
  readonly retryAt: Date | null;
}

function validateClaimant(claimantId: string, leaseSeconds: number): void {
  if (claimantId.trim().length === 0 || claimantId.length > 160) {
    throw new Error("Agent connection job claimant ID must contain between 1 and 160 characters.");
  }
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 900) {
    throw new Error("Agent connection job lease must be between 30 and 900 seconds.");
  }
}

function validateMaxAttempts(maxAttempts: number): void {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
    throw new Error("Agent connection job max attempts must be between 1 and 20.");
  }
}

function validateErrorCode(errorCode: string): void {
  if (!errorCodePattern.test(errorCode)) {
    throw new Error("Agent connection job errors must use a safe machine-readable code.");
  }
}

export async function enqueueAgentConnectionJob(
  db: TrialRunDatabase,
  input: {
    readonly connectionId: string;
    readonly kind: AgentConnectionJobKind;
    readonly maxAttempts?: number;
    readonly availableAt?: Date;
  },
): Promise<AgentConnectionJob> {
  const maxAttempts = input.maxAttempts ?? 5;
  validateMaxAttempts(maxAttempts);
  if (input.availableAt && Number.isNaN(input.availableAt.getTime())) {
    throw new Error("Agent connection job availability must be a valid date.");
  }

  return db.transaction(async (tx) => {
    const [connection] = await tx
      .select({ id: agentConnections.id, mode: agentConnections.mode })
      .from(agentConnections)
      .where(eq(agentConnections.id, input.connectionId))
      .limit(1)
      .for("update");
    if (!connection) throw new Error("Agent connection does not exist.");
    if (connection.mode !== "codex_workspace") {
      throw new Error("Only Codex workspace connections can enqueue workspace lifecycle jobs.");
    }

    const [existing] = await tx
      .select()
      .from(agentConnectionJobs)
      .where(
        and(
          eq(agentConnectionJobs.connectionId, connection.id),
          inArray(agentConnectionJobs.status, ["queued", "running"]),
        ),
      )
      .limit(1);
    if (existing) {
      if (existing.kind !== input.kind) {
        throw new Error(
          `Agent connection already has an active ${existing.kind} job; ${input.kind} was not enqueued.`,
        );
      }
      return existing;
    }

    const [created] = await tx
      .insert(agentConnectionJobs)
      .values({
        connectionId: connection.id,
        kind: input.kind,
        maxAttempts,
        availableAt: input.availableAt,
      })
      .returning();
    if (!created) throw new Error("Agent connection job was not enqueued.");
    return created;
  });
}

export async function claimNextAgentConnectionJob(
  db: TrialRunDatabase,
  claimantId: string,
  leaseSeconds: number,
): Promise<AgentConnectionJobClaim | null> {
  validateClaimant(claimantId, leaseSeconds);
  return db.transaction(async (tx) => {
    const now = new Date();
    const [candidate] = await tx
      .select()
      .from(agentConnectionJobs)
      .where(
        and(
          eq(agentConnectionJobs.status, "queued"),
          lte(agentConnectionJobs.availableAt, now),
          sql`${agentConnectionJobs.attempts} < ${agentConnectionJobs.maxAttempts}`,
        ),
      )
      .orderBy(asc(agentConnectionJobs.availableAt), asc(agentConnectionJobs.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate) return null;

    const [connection] = await tx
      .select()
      .from(agentConnections)
      .where(eq(agentConnections.id, candidate.connectionId))
      .limit(1);
    if (!connection) throw new Error("Agent connection job lost its connection record.");
    if (connection.mode !== "codex_workspace") {
      await tx
        .update(agentConnectionJobs)
        .set({ status: "failed", lastErrorCode: "invalid_connection_mode" })
        .where(
          and(eq(agentConnectionJobs.id, candidate.id), eq(agentConnectionJobs.status, "queued")),
        );
      return null;
    }

    const attempt = candidate.attempts + 1;
    const [claimed] = await tx
      .update(agentConnectionJobs)
      .set({
        status: "running",
        attempts: attempt,
        lockedBy: claimantId,
        leaseExpiresAt: new Date(now.getTime() + leaseSeconds * 1_000),
        lastErrorCode: null,
      })
      .where(
        and(
          eq(agentConnectionJobs.id, candidate.id),
          eq(agentConnectionJobs.status, "queued"),
          eq(agentConnectionJobs.attempts, candidate.attempts),
        ),
      )
      .returning({ id: agentConnectionJobs.id });
    if (!claimed) return null;

    return {
      jobId: candidate.id,
      connectionId: candidate.connectionId,
      kind: candidate.kind,
      claimantId,
      attempt,
      maxAttempts: candidate.maxAttempts,
      connection,
    };
  });
}

function claimFence(claim: AgentConnectionJobClaim) {
  return and(
    eq(agentConnectionJobs.id, claim.jobId),
    eq(agentConnectionJobs.connectionId, claim.connectionId),
    eq(agentConnectionJobs.kind, claim.kind),
    eq(agentConnectionJobs.status, "running"),
    eq(agentConnectionJobs.lockedBy, claim.claimantId),
    eq(agentConnectionJobs.attempts, claim.attempt),
  );
}

export async function heartbeatAgentConnectionJob(
  db: TrialRunDatabase,
  claim: AgentConnectionJobClaim,
  leaseSeconds: number,
): Promise<boolean> {
  validateClaimant(claim.claimantId, leaseSeconds);
  const [updated] = await db
    .update(agentConnectionJobs)
    .set({ leaseExpiresAt: new Date(Date.now() + leaseSeconds * 1_000) })
    .where(claimFence(claim))
    .returning({ id: agentConnectionJobs.id });
  return Boolean(updated);
}

export async function completeAgentConnectionJob(
  db: TrialRunDatabase,
  claim: AgentConnectionJobClaim,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [completed] = await tx
      .update(agentConnectionJobs)
      .set({
        status: "succeeded",
        lockedBy: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
      })
      .where(claimFence(claim))
      .returning({ id: agentConnectionJobs.id });
    if (!completed) return false;
    await tx
      .update(agentConnections)
      .set({ lastErrorCode: null })
      .where(eq(agentConnections.id, claim.connectionId));
    return true;
  });
}

export async function failAgentConnectionJob(
  db: TrialRunDatabase,
  claim: AgentConnectionJobClaim,
  errorCode: string,
): Promise<AgentConnectionJobFailure | null> {
  validateErrorCode(errorCode);
  const exhausted = claim.attempt >= claim.maxAttempts;
  const retryAt = exhausted
    ? null
    : new Date(Date.now() + Math.min(60, 2 ** claim.attempt) * 1_000);

  return db.transaction(async (tx) => {
    const [failed] = await tx
      .update(agentConnectionJobs)
      .set({
        status: exhausted ? "failed" : "queued",
        availableAt: retryAt ?? new Date(),
        lockedBy: null,
        leaseExpiresAt: null,
        lastErrorCode: errorCode,
      })
      .where(claimFence(claim))
      .returning({ id: agentConnectionJobs.id });
    if (!failed) return null;
    await tx
      .update(agentConnections)
      .set({ lastErrorCode: errorCode })
      .where(eq(agentConnections.id, claim.connectionId));
    return { exhausted, retryAt };
  });
}

export async function recoverExpiredAgentConnectionJobs(db: TrialRunDatabase): Promise<number> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const expired = await tx
      .select()
      .from(agentConnectionJobs)
      .where(
        and(eq(agentConnectionJobs.status, "running"), lt(agentConnectionJobs.leaseExpiresAt, now)),
      )
      .orderBy(asc(agentConnectionJobs.leaseExpiresAt), asc(agentConnectionJobs.createdAt))
      .limit(100)
      .for("update", { skipLocked: true });

    let recovered = 0;
    for (const job of expired) {
      if (!job.lockedBy) continue;
      const exhausted = job.attempts >= job.maxAttempts;
      const errorCode = exhausted ? "job_lease_expired_exhausted" : "job_lease_expired";
      const [updated] = await tx
        .update(agentConnectionJobs)
        .set({
          status: exhausted ? "failed" : "queued",
          availableAt: now,
          lockedBy: null,
          leaseExpiresAt: null,
          lastErrorCode: errorCode,
        })
        .where(
          and(
            eq(agentConnectionJobs.id, job.id),
            eq(agentConnectionJobs.status, "running"),
            eq(agentConnectionJobs.lockedBy, job.lockedBy),
            eq(agentConnectionJobs.attempts, job.attempts),
          ),
        )
        .returning({ id: agentConnectionJobs.id });
      if (!updated) continue;
      await tx
        .update(agentConnections)
        .set({ lastErrorCode: errorCode })
        .where(eq(agentConnections.id, job.connectionId));
      recovered += 1;
    }
    return recovered;
  });
}
