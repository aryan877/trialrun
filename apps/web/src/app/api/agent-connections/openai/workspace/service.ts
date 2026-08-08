import "server-only";

import { and, desc, eq, gt, inArray } from "drizzle-orm";

import {
  agentConnectionAuthChallenges,
  agentConnectionJobs,
  agentConnections,
  enqueueAgentConnectionJob,
  users,
  type AgentConnectionJobKind,
} from "@trialrun/db";
import { decodeBase64Key } from "@trialrun/domain";

import { database } from "@/lib/db";
import { serverEnv } from "@/lib/env";

import { decryptWorkspaceVerification } from "./challenge";
import {
  emptyWorkspaceConnectionMetadata,
  workspaceConnectionMetadataSchema,
  type WorkspaceConnectionAction,
  type WorkspaceConnectionMetadata,
  type WorkspaceOperation,
} from "./contract";

export class WorkspaceLifecycleConflictError extends Error {}

interface WorkspaceMetadataSource {
  readonly status:
    | "pending"
    | "provisioning"
    | "awaiting_auth"
    | "connected"
    | "reauth_required"
    | "revoking"
    | "revoked"
    | "failed";
  readonly updatedAt: Date;
  readonly lastVerifiedAt: Date | null;
}

export function workspaceConnectionMetadata(input: {
  readonly source: WorkspaceMetadataSource | null | undefined;
  readonly operation: WorkspaceOperation;
  readonly verification: WorkspaceConnectionMetadata["verification"];
}): WorkspaceConnectionMetadata {
  if (!input.source) return emptyWorkspaceConnectionMetadata();
  return workspaceConnectionMetadataSchema.parse({
    provider: "openai",
    mode: "codex_workspace",
    configured: input.source.status !== "revoked",
    status: input.source.status,
    operation: input.operation,
    updatedAt: input.source.updatedAt.toISOString(),
    lastVerifiedAt: input.source.lastVerifiedAt?.toISOString() ?? null,
    verification: input.source.status === "awaiting_auth" ? input.verification : null,
  });
}

export async function readWorkspaceConnection(
  userId: string,
): Promise<WorkspaceConnectionMetadata> {
  const db = database();
  const [connection] = await db
    .select({
      id: agentConnections.id,
      mode: agentConnections.mode,
      status: agentConnections.status,
      updatedAt: agentConnections.updatedAt,
      lastVerifiedAt: agentConnections.lastVerifiedAt,
    })
    .from(agentConnections)
    .where(and(eq(agentConnections.userId, userId), eq(agentConnections.provider, "openai")))
    .limit(1);
  if (!connection || connection.mode !== "codex_workspace") {
    return emptyWorkspaceConnectionMetadata();
  }

  const [[activeJob], [challenge]] = await Promise.all([
    db
      .select({ kind: agentConnectionJobs.kind })
      .from(agentConnectionJobs)
      .where(
        and(
          eq(agentConnectionJobs.connectionId, connection.id),
          inArray(agentConnectionJobs.status, ["queued", "running"]),
        ),
      )
      .limit(1),
    connection.status === "awaiting_auth"
      ? db
          .select({
            id: agentConnectionAuthChallenges.id,
            keyVersion: agentConnectionAuthChallenges.keyVersion,
            iv: agentConnectionAuthChallenges.iv,
            ciphertext: agentConnectionAuthChallenges.ciphertext,
            authTag: agentConnectionAuthChallenges.authTag,
            verificationUri: agentConnectionAuthChallenges.verificationUri,
            expiresAt: agentConnectionAuthChallenges.expiresAt,
          })
          .from(agentConnectionAuthChallenges)
          .where(
            and(
              eq(agentConnectionAuthChallenges.connectionId, connection.id),
              gt(agentConnectionAuthChallenges.expiresAt, new Date()),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
  ]);

  let verification: WorkspaceConnectionMetadata["verification"] = null;
  if (challenge) {
    try {
      const env = serverEnv();
      verification = decryptWorkspaceVerification({
        userId,
        connectionId: connection.id,
        challengeId: challenge.id,
        encrypted: challenge,
        verificationUri: challenge.verificationUri,
        expiresAt: challenge.expiresAt,
        vaultKey: decodeBase64Key(env.VAULT_KEY_BASE64 ?? "", "VAULT_KEY_BASE64"),
      });
    } catch {
      verification = null;
    }
  }

  return workspaceConnectionMetadata({
    source: connection,
    operation: activeJob?.kind ?? null,
    verification,
  });
}

function retryKind(input: {
  readonly status: WorkspaceMetadataSource["status"];
  readonly latestKind: AgentConnectionJobKind | null;
  readonly hasUnexpiredChallenge: boolean;
}): AgentConnectionJobKind | null {
  if (input.status === "connected") return null;
  if (input.status === "revoking") return "delete";
  if (input.status === "pending" || input.status === "provisioning") return "provision";
  if (input.status === "awaiting_auth" || input.status === "reauth_required") {
    return input.status === "awaiting_auth" && input.hasUnexpiredChallenge
      ? "verify"
      : "authenticate";
  }
  if (input.status === "failed") {
    if (input.latestKind === "delete") return "delete";
    if (input.latestKind === "provision" || !input.latestKind) return "provision";
    if (input.latestKind === "verify" && input.hasUnexpiredChallenge) return "verify";
    return "authenticate";
  }
  return null;
}

async function connectWorkspace(userId: string): Promise<{ id: string; enqueue: boolean }> {
  return database().transaction(async (tx) => {
    const [owner] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .for("update");
    if (!owner) throw new WorkspaceLifecycleConflictError("The account no longer exists.");

    const [existing] = await tx
      .select({
        id: agentConnections.id,
        mode: agentConnections.mode,
        status: agentConnections.status,
      })
      .from(agentConnections)
      .where(and(eq(agentConnections.userId, userId), eq(agentConnections.provider, "openai")))
      .limit(1)
      .for("update");
    if (existing?.mode === "codex_workspace" && existing.status !== "revoked") {
      if (existing.status === "failed" || existing.status === "reauth_required") {
        throw new WorkspaceLifecycleConflictError("Retry the existing workspace connection.");
      }
      return {
        id: existing.id,
        enqueue: existing.status === "pending" || existing.status === "provisioning",
      };
    }

    const now = new Date();
    const freshWorkspace = {
      mode: "codex_workspace" as const,
      status: "pending" as const,
      keyVersion: null,
      iv: null,
      ciphertext: null,
      authTag: null,
      zcpProjectId: null,
      zcpServiceId: null,
      workspaceOwnershipTokenHash: null,
      workspaceBridgeUrl: null,
      lastErrorCode: null,
      lastVerifiedAt: null,
      deletionStartedAt: null,
      deletionCompletedAt: null,
      deletionProof: null,
      revokedAt: null,
      updatedAt: now,
    };
    if (existing) {
      await tx
        .delete(agentConnectionAuthChallenges)
        .where(eq(agentConnectionAuthChallenges.connectionId, existing.id));
      const [updated] = await tx
        .update(agentConnections)
        .set(freshWorkspace)
        .where(
          and(
            eq(agentConnections.id, existing.id),
            eq(agentConnections.userId, userId),
            eq(agentConnections.provider, "openai"),
          ),
        )
        .returning({ id: agentConnections.id });
      if (!updated) throw new WorkspaceLifecycleConflictError("The connection changed.");
      return { id: updated.id, enqueue: true };
    }
    const [created] = await tx
      .insert(agentConnections)
      .values({ userId, provider: "openai", ...freshWorkspace })
      .returning({ id: agentConnections.id });
    if (!created) throw new Error("The workspace connection was not created.");
    return { id: created.id, enqueue: true };
  });
}

async function verifyWorkspace(userId: string): Promise<{ id: string; enqueue: boolean }> {
  return database().transaction(async (tx) => {
    const [connection] = await tx
      .select({
        id: agentConnections.id,
        mode: agentConnections.mode,
        status: agentConnections.status,
      })
      .from(agentConnections)
      .where(and(eq(agentConnections.userId, userId), eq(agentConnections.provider, "openai")))
      .limit(1)
      .for("update");
    if (!connection || connection.mode !== "codex_workspace") {
      throw new WorkspaceLifecycleConflictError("Connect a Codex workspace first.");
    }
    if (connection.status === "connected") return { id: connection.id, enqueue: false };
    if (connection.status !== "awaiting_auth") {
      throw new WorkspaceLifecycleConflictError("The workspace is not awaiting authorization.");
    }
    const [challenge] = await tx
      .select({ id: agentConnectionAuthChallenges.id })
      .from(agentConnectionAuthChallenges)
      .where(
        and(
          eq(agentConnectionAuthChallenges.connectionId, connection.id),
          gt(agentConnectionAuthChallenges.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!challenge) {
      throw new WorkspaceLifecycleConflictError("The authorization code expired. Retry it.");
    }
    return { id: connection.id, enqueue: true };
  });
}

async function retryWorkspace(
  userId: string,
): Promise<{ id: string; kind: AgentConnectionJobKind | null }> {
  return database().transaction(async (tx) => {
    const [connection] = await tx
      .select({
        id: agentConnections.id,
        mode: agentConnections.mode,
        status: agentConnections.status,
      })
      .from(agentConnections)
      .where(and(eq(agentConnections.userId, userId), eq(agentConnections.provider, "openai")))
      .limit(1)
      .for("update");
    if (!connection || connection.mode !== "codex_workspace" || connection.status === "revoked") {
      throw new WorkspaceLifecycleConflictError("Connect a Codex workspace first.");
    }
    const [active] = await tx
      .select({ kind: agentConnectionJobs.kind })
      .from(agentConnectionJobs)
      .where(
        and(
          eq(agentConnectionJobs.connectionId, connection.id),
          inArray(agentConnectionJobs.status, ["queued", "running"]),
        ),
      )
      .limit(1);
    if (active) return { id: connection.id, kind: null };

    const [[latest], [challenge]] = await Promise.all([
      tx
        .select({ kind: agentConnectionJobs.kind })
        .from(agentConnectionJobs)
        .where(eq(agentConnectionJobs.connectionId, connection.id))
        .orderBy(desc(agentConnectionJobs.createdAt))
        .limit(1),
      tx
        .select({ id: agentConnectionAuthChallenges.id })
        .from(agentConnectionAuthChallenges)
        .where(
          and(
            eq(agentConnectionAuthChallenges.connectionId, connection.id),
            gt(agentConnectionAuthChallenges.expiresAt, new Date()),
          ),
        )
        .limit(1),
    ]);
    const kind = retryKind({
      status: connection.status,
      latestKind: latest?.kind ?? null,
      hasUnexpiredChallenge: Boolean(challenge),
    });
    if (!kind) return { id: connection.id, kind: null };

    if (kind === "authenticate") {
      await tx
        .delete(agentConnectionAuthChallenges)
        .where(eq(agentConnectionAuthChallenges.connectionId, connection.id));
    }
    const status =
      kind === "provision"
        ? "pending"
        : kind === "verify"
          ? "awaiting_auth"
          : kind === "delete"
            ? "revoking"
            : "reauth_required";
    await tx
      .update(agentConnections)
      .set({ status, lastErrorCode: null, updatedAt: new Date() })
      .where(and(eq(agentConnections.id, connection.id), eq(agentConnections.userId, userId)));
    return { id: connection.id, kind };
  });
}

async function revokeWorkspace(userId: string): Promise<{ id: string; enqueue: boolean }> {
  return database().transaction(async (tx) => {
    const [connection] = await tx
      .select({
        id: agentConnections.id,
        mode: agentConnections.mode,
        status: agentConnections.status,
        deletionStartedAt: agentConnections.deletionStartedAt,
      })
      .from(agentConnections)
      .where(and(eq(agentConnections.userId, userId), eq(agentConnections.provider, "openai")))
      .limit(1)
      .for("update");
    if (!connection || connection.mode !== "codex_workspace") {
      throw new WorkspaceLifecycleConflictError("No Codex workspace is configured.");
    }
    if (connection.status === "revoked") return { id: connection.id, enqueue: false };
    const [active] = await tx
      .select({ kind: agentConnectionJobs.kind })
      .from(agentConnectionJobs)
      .where(
        and(
          eq(agentConnectionJobs.connectionId, connection.id),
          inArray(agentConnectionJobs.status, ["queued", "running"]),
        ),
      )
      .limit(1);
    if (active && active.kind !== "delete") {
      throw new WorkspaceLifecycleConflictError(
        "Wait for the current workspace step to finish, then revoke it.",
      );
    }
    await tx
      .delete(agentConnectionAuthChallenges)
      .where(eq(agentConnectionAuthChallenges.connectionId, connection.id));
    await tx
      .update(agentConnections)
      .set({
        status: "revoking",
        deletionStartedAt: connection.deletionStartedAt ?? new Date(),
        deletionCompletedAt: null,
        deletionProof: null,
        revokedAt: null,
        lastErrorCode: null,
        updatedAt: new Date(),
      })
      .where(and(eq(agentConnections.id, connection.id), eq(agentConnections.userId, userId)));
    return { id: connection.id, enqueue: true };
  });
}

export async function performWorkspaceAction(
  userId: string,
  action: WorkspaceConnectionAction,
): Promise<WorkspaceConnectionMetadata> {
  if (action.intent === "connect") {
    const result = await connectWorkspace(userId);
    if (result.enqueue) {
      await enqueueAgentConnectionJob(database(), {
        connectionId: result.id,
        kind: "provision",
      });
    }
  } else if (action.intent === "verify") {
    const result = await verifyWorkspace(userId);
    if (result.enqueue) {
      await enqueueAgentConnectionJob(database(), { connectionId: result.id, kind: "verify" });
    }
  } else if (action.intent === "retry") {
    const result = await retryWorkspace(userId);
    if (result.kind) {
      await enqueueAgentConnectionJob(database(), { connectionId: result.id, kind: result.kind });
    }
  } else {
    const result = await revokeWorkspace(userId);
    if (result.enqueue) {
      await enqueueAgentConnectionJob(database(), { connectionId: result.id, kind: "delete" });
    }
  }
  return readWorkspaceConnection(userId);
}
