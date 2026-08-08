import { encryptSecret } from "@trialrun/domain";

import type { PutOpenAiConnection } from "./contract";

export interface StoredOpenAiConnectionMaterial {
  readonly mode: "managed" | "api_key";
  readonly status: "connected";
  readonly keyVersion: number | null;
  readonly iv: string | null;
  readonly ciphertext: string | null;
  readonly authTag: string | null;
  readonly zcpProjectId: null;
  readonly zcpServiceId: null;
  readonly lastVerifiedAt: null;
  readonly revokedAt: null;
}

export interface RevokedOpenAiConnectionMaterial {
  readonly mode: "managed";
  readonly status: "revoked";
  readonly keyVersion: null;
  readonly iv: null;
  readonly ciphertext: null;
  readonly authTag: null;
  readonly zcpProjectId: null;
  readonly zcpServiceId: null;
  readonly lastVerifiedAt: null;
  readonly revokedAt: Date;
}

export function openAiConnectionAssociatedData(userId: string, connectionId: string): string {
  return `trialrun:agent-connection:${userId}:${connectionId}`;
}

export function storedOpenAiConnectionMaterial(input: {
  readonly connectionId: string;
  readonly userId: string;
  readonly request: PutOpenAiConnection;
  readonly vaultKey: Uint8Array | null;
  readonly keyVersion: number;
}): StoredOpenAiConnectionMaterial {
  if (input.request.mode === "managed") {
    return {
      mode: "managed",
      status: "connected",
      keyVersion: null,
      iv: null,
      ciphertext: null,
      authTag: null,
      zcpProjectId: null,
      zcpServiceId: null,
      lastVerifiedAt: null,
      revokedAt: null,
    };
  }
  if (!input.vaultKey) {
    throw new Error("Encrypted API-key storage is unavailable.");
  }
  const encrypted = encryptSecret(
    input.request.apiKey,
    input.vaultKey,
    input.keyVersion,
    openAiConnectionAssociatedData(input.userId, input.connectionId),
  );
  return {
    mode: "api_key",
    status: "connected",
    ...encrypted,
    zcpProjectId: null,
    zcpServiceId: null,
    lastVerifiedAt: null,
    revokedAt: null,
  };
}

export function revokedOpenAiConnectionMaterial(now: Date): RevokedOpenAiConnectionMaterial {
  return {
    mode: "managed",
    status: "revoked",
    keyVersion: null,
    iv: null,
    ciphertext: null,
    authTag: null,
    zcpProjectId: null,
    zcpServiceId: null,
    lastVerifiedAt: null,
    revokedAt: now,
  };
}
