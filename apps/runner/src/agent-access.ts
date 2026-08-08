import { resolve } from "node:path";

import { and, eq } from "drizzle-orm";

import { agentConnections, type TrialRunDatabase } from "@trialrun/db";
import { decodeBase64Key, decryptSecret } from "@trialrun/domain";

import { runnerConfig } from "./config.js";
import { WorkspaceBridgeClient } from "./workspace-bridge-client.js";

export type AgentAccess =
  | {
      readonly connectionId: string;
      readonly mode: "managed";
      readonly apiKey?: string;
      readonly codexHome?: string;
    }
  | {
      readonly connectionId: string;
      readonly mode: "api_key";
      readonly apiKey: string;
    }
  | {
      readonly connectionId: string;
      readonly mode: "codex_workspace";
      readonly bridgeUrl: string;
      readonly zcpProjectId: string;
      readonly zcpServiceId: string;
    };

function managedAgentAccess(connectionId: string): AgentAccess {
  if (runnerConfig.MANAGED_CODEX_HOME) {
    return {
      connectionId,
      mode: "managed",
      codexHome: resolve(runnerConfig.MANAGED_CODEX_HOME),
    };
  }
  if (runnerConfig.MANAGED_OPENAI_API_KEY) {
    return {
      connectionId,
      mode: "managed",
      apiKey: runnerConfig.MANAGED_OPENAI_API_KEY,
    };
  }
  throw new Error("Managed Codex is not configured with an API key or authenticated Codex home.");
}

export async function loadAgentAccess(
  db: TrialRunDatabase,
  input: { readonly userId: string; readonly connectionId: string | null },
): Promise<AgentAccess> {
  if (!input.connectionId) {
    throw new Error("The job does not identify the Codex connection selected when it was queued.");
  }
  const [connection] = await db
    .select()
    .from(agentConnections)
    .where(
      and(
        eq(agentConnections.id, input.connectionId),
        eq(agentConnections.userId, input.userId),
        eq(agentConnections.provider, "openai"),
        eq(agentConnections.status, "connected"),
      ),
    )
    .limit(1);
  if (!connection) {
    throw new Error("The Codex connection selected for this job is no longer connected.");
  }
  if (connection.mode === "managed") return managedAgentAccess(connection.id);
  if (connection.mode === "codex_workspace") {
    if (!connection.zcpProjectId || !connection.zcpServiceId || !connection.workspaceBridgeUrl) {
      throw new Error("The selected Codex workspace is missing its verified Zerops bridge.");
    }
    return {
      connectionId: connection.id,
      mode: "codex_workspace",
      bridgeUrl: connection.workspaceBridgeUrl,
      zcpProjectId: connection.zcpProjectId,
      zcpServiceId: connection.zcpServiceId,
    };
  }
  if (
    !runnerConfig.VAULT_KEY_BASE64 ||
    connection.keyVersion !== runnerConfig.VAULT_KEY_VERSION ||
    !connection.iv ||
    !connection.ciphertext ||
    !connection.authTag
  ) {
    throw new Error("The selected user API key cannot be decrypted with the active vault key.");
  }
  const key = decodeBase64Key(runnerConfig.VAULT_KEY_BASE64, "VAULT_KEY_BASE64");
  return {
    connectionId: connection.id,
    mode: "api_key",
    apiKey: decryptSecret(
      {
        keyVersion: connection.keyVersion,
        iv: connection.iv,
        ciphertext: connection.ciphertext,
        authTag: connection.authTag,
      },
      key,
      `trialrun:agent-connection:${connection.userId}:${connection.id}`,
    ),
  };
}

export function workspaceBridgeClient(
  access: Extract<AgentAccess, { readonly mode: "codex_workspace" }>,
): WorkspaceBridgeClient {
  if (!runnerConfig.TRIALRUN_BRIDGE_SIGNING_PRIVATE_KEY_BASE64) {
    throw new Error("The runner does not have its workspace bridge signing key.");
  }
  return new WorkspaceBridgeClient({
    bridgeUrl: access.bridgeUrl,
    connectionId: access.connectionId,
    signingPrivateKeyBase64: runnerConfig.TRIALRUN_BRIDGE_SIGNING_PRIVATE_KEY_BASE64,
  });
}
