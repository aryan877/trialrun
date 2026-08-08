import { describe, expect, it } from "vitest";

import { decryptSecret } from "@trialrun/domain";

import {
  openAiConnectionAssociatedData,
  revokedOpenAiConnectionMaterial,
  storedOpenAiConnectionMaterial,
} from "./connection-material";

const userId = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";
const vaultKey = Buffer.alloc(32, 7);
const apiKey = "sk-test-customer-key-never-returned";

describe("OpenAI connection secret material", () => {
  it("binds an encrypted API key to the exact user and durable connection ID", () => {
    const stored = storedOpenAiConnectionMaterial({
      userId,
      connectionId,
      request: { mode: "api_key", csrfToken: "csrf-token-long-enough-for-validation", apiKey },
      vaultKey,
      keyVersion: 4,
    });
    expect(stored.mode).toBe("api_key");
    expect(stored.keyVersion).toBe(4);
    expect(stored.ciphertext).not.toContain(apiKey);
    expect(
      decryptSecret(
        {
          keyVersion: stored.keyVersion ?? 0,
          iv: stored.iv ?? "",
          ciphertext: stored.ciphertext ?? "",
          authTag: stored.authTag ?? "",
        },
        vaultKey,
        openAiConnectionAssociatedData(userId, connectionId),
      ),
    ).toBe(apiKey);
    expect(() =>
      decryptSecret(
        {
          keyVersion: stored.keyVersion ?? 0,
          iv: stored.iv ?? "",
          ciphertext: stored.ciphertext ?? "",
          authTag: stored.authTag ?? "",
        },
        vaultKey,
        openAiConnectionAssociatedData(userId, "33333333-3333-4333-8333-333333333333"),
      ),
    ).toThrow();
  });

  it("keeps managed mode and revocation free of secret material", () => {
    const managed = storedOpenAiConnectionMaterial({
      userId,
      connectionId,
      request: { mode: "managed", csrfToken: "csrf-token-long-enough-for-validation" },
      vaultKey: null,
      keyVersion: 4,
    });
    expect(managed).toMatchObject({
      mode: "managed",
      status: "connected",
      keyVersion: null,
      iv: null,
      ciphertext: null,
      authTag: null,
    });

    const revokedAt = new Date("2026-08-08T12:00:00.000Z");
    expect(revokedOpenAiConnectionMaterial(revokedAt)).toEqual({
      mode: "managed",
      status: "revoked",
      keyVersion: null,
      iv: null,
      ciphertext: null,
      authTag: null,
      zcpProjectId: null,
      zcpServiceId: null,
      lastVerifiedAt: null,
      revokedAt,
    });
  });
});
