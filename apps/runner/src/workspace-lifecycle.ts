import { createPrivateKey, createPublicKey, randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import {
  agentConnectionAuthChallenges,
  agentConnections,
  claimNextAgentConnectionJob,
  completeAgentConnectionJob,
  enqueueAgentConnectionJob,
  failAgentConnectionJob,
  heartbeatAgentConnectionJob,
  type AgentConnectionJobClaim,
  type TrialRunDatabase,
} from "@trialrun/db";
import {
  decodeBase64Key,
  encryptSecret,
  hashToken,
  randomToken,
  redactText,
} from "@trialrun/domain";
import { z } from "zod";

import { WorkspaceBridgeClient } from "./workspace-bridge-client.js";
import type {
  WorkspaceProvisionedIdentity,
  ZeropsWorkspacePlatformClient,
} from "./workspace-platform.js";

export interface WorkspaceLifecycleWorkerOptions {
  readonly db: TrialRunDatabase;
  readonly claimantId: string;
  readonly leaseSeconds: number;
  readonly signingPrivateKeyBase64: string;
  readonly vaultKeyBase64: string;
  readonly vaultKeyVersion: number;
  readonly platform: ZeropsWorkspacePlatformClient;
  readonly repositoryMcpUrl: string;
  readonly jobTimeoutMs?: number;
  readonly logError?: (message: string) => void;
}

function workspaceAuthChallengeAssociatedData(
  userId: string,
  connectionId: string,
  challengeId: string,
): string {
  return `trialrun:agent-connection-auth-challenge:${userId}:${connectionId}:${challengeId}`;
}

function publicSigningKey(privateKeyBase64: string): string {
  const decoded = Buffer.from(z.base64().parse(privateKeyBase64), "base64");
  const privateKey = decoded.toString("utf8").startsWith("-----BEGIN PRIVATE KEY-----")
    ? createPrivateKey(decoded)
    : createPrivateKey({ key: decoded, format: "der", type: "pkcs8" });
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("Workspace bridge signing requires an Ed25519 private key.");
  }
  return createPublicKey(privateKey)
    .export({ format: "der", type: "spki" })
    .toString("base64");
}

function lifecycleFailureCode(kind: AgentConnectionJobClaim["kind"]): string {
  return `workspace_${kind}_failed`;
}

export class WorkspaceLifecycleWorker {
  readonly #claimantId: string;
  readonly #db: TrialRunDatabase;
  readonly #jobTimeoutMs: number;
  readonly #leaseSeconds: number;
  readonly #logError: (message: string) => void;
  readonly #platform: ZeropsWorkspacePlatformClient;
  readonly #publicSigningKey: string;
  readonly #repositoryMcpUrl: string;
  readonly #signingPrivateKeyBase64: string;
  readonly #vaultKey: Uint8Array;
  readonly #vaultKeyVersion: number;

  constructor(options: WorkspaceLifecycleWorkerOptions) {
    this.#db = options.db;
    this.#claimantId = z.string().trim().min(1).max(160).parse(options.claimantId);
    this.#leaseSeconds = z.number().int().min(30).max(900).parse(options.leaseSeconds);
    this.#signingPrivateKeyBase64 = z.base64().parse(options.signingPrivateKeyBase64);
    this.#publicSigningKey = publicSigningKey(this.#signingPrivateKeyBase64);
    this.#vaultKey = decodeBase64Key(options.vaultKeyBase64, "VAULT_KEY_BASE64");
    this.#vaultKeyVersion = z.number().int().positive().parse(options.vaultKeyVersion);
    this.#platform = options.platform;
    this.#repositoryMcpUrl = z
      .url()
      .refine((value) => new URL(value).pathname === "/api/agent-tools/repository/mcp")
      .parse(options.repositoryMcpUrl);
    this.#jobTimeoutMs = z
      .number()
      .int()
      .min(30_000)
      .max(3_600_000)
      .parse(options.jobTimeoutMs ?? 15 * 60_000);
    this.#logError = options.logError ?? (() => undefined);
  }

  async runOnce(signal?: AbortSignal): Promise<boolean> {
    const claim = await claimNextAgentConnectionJob(
      this.#db,
      this.#claimantId,
      this.#leaseSeconds,
    );
    if (!claim) return false;

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error("Workspace lifecycle job timed out.")),
      this.#jobTimeoutMs,
    );
    const operationSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    let heartbeatRunning = false;
    const heartbeat = setInterval(() => {
      if (heartbeatRunning) return;
      heartbeatRunning = true;
      void heartbeatAgentConnectionJob(this.#db, claim, this.#leaseSeconds)
        .then((renewed) => {
          if (!renewed) controller.abort(new Error("Runner lost its workspace lifecycle lease."));
        })
        .catch((error: unknown) => controller.abort(error))
        .finally(() => {
          heartbeatRunning = false;
        });
    }, Math.floor((this.#leaseSeconds * 1_000) / 3));

    try {
      operationSignal.throwIfAborted();
      const followUp = await this.#execute(claim, operationSignal);
      operationSignal.throwIfAborted();
      if (!(await completeAgentConnectionJob(this.#db, claim))) return true;
      if (followUp) {
        await enqueueAgentConnectionJob(this.#db, {
          connectionId: claim.connectionId,
          kind: followUp,
        });
      }
    } catch (error) {
      const code = lifecycleFailureCode(claim.kind);
      const failure = await failAgentConnectionJob(this.#db, claim, code);
      if (failure?.exhausted) await this.#markExhausted(claim);
      const message = redactText(error instanceof Error ? error.message : String(error), [
        this.#signingPrivateKeyBase64,
      ]);
      this.#logError(`${claim.kind} for ${claim.connectionId} failed as ${code}: ${message}`);
    } finally {
      clearInterval(heartbeat);
      clearTimeout(timeout);
    }
    return true;
  }

  async #execute(
    claim: AgentConnectionJobClaim,
    signal: AbortSignal,
  ): Promise<AgentConnectionJobClaim["kind"] | null> {
    if (claim.kind === "provision") return this.#provision(claim, signal);
    if (claim.kind === "authenticate") return this.#authenticate(claim, signal);
    if (claim.kind === "verify") return this.#verify(claim, signal);
    await this.#delete(claim, signal);
    return null;
  }

  async #provision(
    claim: AgentConnectionJobClaim,
    signal: AbortSignal,
  ): Promise<"authenticate"> {
    const connection = claim.connection;
    if (connection.mode !== "codex_workspace") throw new Error("Connection mode changed.");
    await this.#db
      .update(agentConnections)
      .set({ status: "provisioning", lastErrorCode: null, updatedAt: new Date() })
      .where(and(eq(agentConnections.id, connection.id), eq(agentConnections.userId, connection.userId)));

    const hasProject = Boolean(connection.zcpProjectId);
    const hasService = Boolean(connection.zcpServiceId);
    if (
      hasProject !== hasService ||
      ((hasProject || hasService) && !connection.workspaceOwnershipTokenHash)
    ) {
      throw new Error("Persisted Codex workspace identity is incomplete.");
    }
    const ownershipHash = connection.workspaceOwnershipTokenHash ?? hashToken(randomToken());
    if (!connection.workspaceOwnershipTokenHash) {
      const [persistedOwnership] = await this.#db
        .update(agentConnections)
        .set({ workspaceOwnershipTokenHash: ownershipHash, updatedAt: new Date() })
        .where(
          and(
            eq(agentConnections.id, connection.id),
            eq(agentConnections.userId, connection.userId),
            eq(agentConnections.mode, "codex_workspace"),
            eq(agentConnections.status, "provisioning"),
          ),
        )
        .returning({ id: agentConnections.id });
      if (!persistedOwnership) {
        throw new Error("Codex workspace ownership marker could not be persisted before import.");
      }
    }
    const existing =
      connection.zcpProjectId && connection.zcpServiceId
        ? { projectId: connection.zcpProjectId, serviceId: connection.zcpServiceId }
        : undefined;
    const result = await this.#platform.provision({
      connectionId: connection.id,
      ownershipHash,
      bridgePublicKeyBase64: this.#publicSigningKey,
      repositoryMcpUrl: this.#repositoryMcpUrl,
      ...(existing ? { existing } : {}),
      onCreated: async (identity) => this.#persistCreatedIdentity(connection.id, ownershipHash, identity),
      signal,
    });
    await this.#db
      .update(agentConnections)
      .set({
        zcpProjectId: result.projectId,
        zcpServiceId: result.serviceId,
        workspaceOwnershipTokenHash: ownershipHash,
        workspaceBridgeUrl: result.bridgeUrl,
        status: "reauth_required",
        lastErrorCode: null,
        updatedAt: new Date(),
      })
      .where(and(eq(agentConnections.id, connection.id), eq(agentConnections.userId, connection.userId)));
    return "authenticate";
  }

  async #persistCreatedIdentity(
    connectionId: string,
    ownershipHash: string,
    identity: WorkspaceProvisionedIdentity | { readonly projectId: string; readonly serviceId: string },
  ): Promise<void> {
    const [updated] = await this.#db
      .update(agentConnections)
      .set({
        zcpProjectId: identity.projectId,
        zcpServiceId: identity.serviceId,
        workspaceOwnershipTokenHash: ownershipHash,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(agentConnections.id, connectionId),
          eq(agentConnections.mode, "codex_workspace"),
          eq(agentConnections.status, "provisioning"),
        ),
      )
      .returning({ id: agentConnections.id });
    if (!updated) throw new Error("Codex workspace identity could not be persisted immediately.");
  }

  #bridge(connection: AgentConnectionJobClaim["connection"]): WorkspaceBridgeClient {
    if (!connection.workspaceBridgeUrl) throw new Error("Codex workspace bridge URL is missing.");
    return new WorkspaceBridgeClient({
      bridgeUrl: connection.workspaceBridgeUrl,
      connectionId: connection.id,
      signingPrivateKeyBase64: this.#signingPrivateKeyBase64,
    });
  }

  async #authenticate(
    claim: AgentConnectionJobClaim,
    signal: AbortSignal,
  ): Promise<null> {
    const [connection] = await this.#db
      .select()
      .from(agentConnections)
      .where(eq(agentConnections.id, claim.connectionId))
      .limit(1);
    if (!connection || connection.mode !== "codex_workspace") {
      throw new Error("Codex workspace connection disappeared.");
    }
    const bridge = this.#bridge(connection);
    const challenge = await bridge.startLogin(signal);
    if (challenge.status === "connected") {
      await bridge.probe(signal);
      await this.#markConnected(connection.id);
      return null;
    }
    if (challenge.status !== "awaiting_auth") {
      throw new Error("Codex did not return an authorization challenge.");
    }
    const challengeId = randomUUID();
    const encrypted = encryptSecret(
      challenge.userCode,
      this.#vaultKey,
      this.#vaultKeyVersion,
      workspaceAuthChallengeAssociatedData(connection.userId, connection.id, challengeId),
    );
    await this.#db.transaction(async (tx) => {
      await tx
        .delete(agentConnectionAuthChallenges)
        .where(eq(agentConnectionAuthChallenges.connectionId, connection.id));
      await tx.insert(agentConnectionAuthChallenges).values({
        id: challengeId,
        connectionId: connection.id,
        ...encrypted,
        verificationUri: challenge.verificationUri,
        expiresAt: new Date(challenge.expiresAt),
      });
      await tx
        .update(agentConnections)
        .set({ status: "awaiting_auth", lastErrorCode: null, updatedAt: new Date() })
        .where(eq(agentConnections.id, connection.id));
    });
    return null;
  }

  async #verify(claim: AgentConnectionJobClaim, signal: AbortSignal): Promise<null> {
    const [connection] = await this.#db
      .select()
      .from(agentConnections)
      .where(eq(agentConnections.id, claim.connectionId))
      .limit(1);
    if (!connection || connection.mode !== "codex_workspace") {
      throw new Error("Codex workspace connection disappeared.");
    }
    await this.#bridge(connection).probe(signal);
    await this.#markConnected(connection.id);
    return null;
  }

  async #markConnected(connectionId: string): Promise<void> {
    await this.#db.transaction(async (tx) => {
      await tx
        .delete(agentConnectionAuthChallenges)
        .where(eq(agentConnectionAuthChallenges.connectionId, connectionId));
      await tx
        .update(agentConnections)
        .set({
          status: "connected",
          lastVerifiedAt: new Date(),
          lastErrorCode: null,
          updatedAt: new Date(),
        })
        .where(eq(agentConnections.id, connectionId));
    });
  }

  async #delete(claim: AgentConnectionJobClaim, signal: AbortSignal): Promise<void> {
    const [connection] = await this.#db
      .select()
      .from(agentConnections)
      .where(eq(agentConnections.id, claim.connectionId))
      .limit(1);
    if (!connection || connection.mode !== "codex_workspace") {
      throw new Error("Codex workspace connection disappeared.");
    }
    await this.#db
      .update(agentConnections)
      .set({ status: "revoking", deletionStartedAt: connection.deletionStartedAt ?? new Date() })
      .where(eq(agentConnections.id, connection.id));
    await this.#db
      .delete(agentConnectionAuthChallenges)
      .where(eq(agentConnectionAuthChallenges.connectionId, connection.id));

    if (connection.workspaceBridgeUrl) {
      try {
        await this.#bridge(connection).logout(signal);
      } catch {
        // Project deletion is the credential-erasure boundary even if best-effort logout is unavailable.
      }
    }
    if (!connection.zcpProjectId) {
      await this.#db
        .update(agentConnections)
        .set({ status: "revoked", revokedAt: new Date(), lastErrorCode: null, updatedAt: new Date() })
        .where(eq(agentConnections.id, connection.id));
      return;
    }
    if (!connection.workspaceOwnershipTokenHash) {
      throw new Error("Codex workspace deletion is missing its ownership hash.");
    }
    const proof = await this.#platform.deleteExact({
      connectionId: connection.id,
      projectId: connection.zcpProjectId,
      ownershipHash: connection.workspaceOwnershipTokenHash,
      signal,
    });
    const completedAt = new Date();
    await this.#db
      .update(agentConnections)
      .set({
        status: "revoked",
        deletionCompletedAt: completedAt,
        deletionProof: proof,
        revokedAt: completedAt,
        lastErrorCode: null,
        updatedAt: completedAt,
      })
      .where(eq(agentConnections.id, connection.id));
  }

  async #markExhausted(claim: AgentConnectionJobClaim): Promise<void> {
    const status =
      claim.kind === "delete"
        ? "revoking"
        : claim.kind === "verify"
          ? "reauth_required"
          : "failed";
    await this.#db
      .update(agentConnections)
      .set({ status, updatedAt: new Date() })
      .where(eq(agentConnections.id, claim.connectionId));
  }
}

export const workspaceLifecycleInternals = {
  publicSigningKey,
  workspaceAuthChallengeAssociatedData,
} as const;
