import { describe, expect, it } from "vitest";

import { encryptSecret } from "@trialrun/domain";

import { decryptWorkspaceVerification, workspaceAuthChallengeAssociatedData } from "./challenge";

const ownerId = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";
const challengeId = "33333333-3333-4333-8333-333333333333";
const vaultKey = Buffer.alloc(32, 9);

describe("Codex workspace authorization challenge", () => {
  it("binds the encrypted one-time code to owner, connection, and challenge", () => {
    expect(workspaceAuthChallengeAssociatedData(ownerId, connectionId, challengeId)).toBe(
      `trialrun:agent-connection-auth-challenge:${ownerId}:${connectionId}:${challengeId}`,
    );
    const encrypted = encryptSecret(
      "ABCD-1234",
      vaultKey,
      1,
      workspaceAuthChallengeAssociatedData(ownerId, connectionId, challengeId),
    );
    expect(
      decryptWorkspaceVerification({
        userId: ownerId,
        connectionId,
        challengeId,
        encrypted,
        verificationUri: "https://auth.openai.com/codex/device",
        expiresAt: new Date("2026-08-08T12:15:00.000Z"),
        vaultKey,
      }),
    ).toEqual({
      verificationUri: "https://auth.openai.com/codex/device",
      userCode: "ABCD-1234",
      expiresAt: "2026-08-08T12:15:00.000Z",
    });
    expect(() =>
      decryptWorkspaceVerification({
        userId: "44444444-4444-4444-8444-444444444444",
        connectionId,
        challengeId,
        encrypted,
        verificationUri: "https://auth.openai.com/codex/device",
        expiresAt: new Date("2026-08-08T12:15:00.000Z"),
        vaultKey,
      }),
    ).toThrow();
  });

  it("rejects untrusted verification links and malformed plaintext", () => {
    const encrypted = encryptSecret(
      "not-a-device-code",
      vaultKey,
      1,
      workspaceAuthChallengeAssociatedData(ownerId, connectionId, challengeId),
    );
    expect(() =>
      decryptWorkspaceVerification({
        userId: ownerId,
        connectionId,
        challengeId,
        encrypted,
        verificationUri: "https://example.test/device",
        expiresAt: new Date("2026-08-08T12:15:00.000Z"),
        vaultKey,
      }),
    ).toThrow();
  });

  it("accepts the current Codex device-code shape", () => {
    const encrypted = encryptSecret(
      "GS4I-40ZGK",
      vaultKey,
      1,
      workspaceAuthChallengeAssociatedData(ownerId, connectionId, challengeId),
    );
    expect(
      decryptWorkspaceVerification({
        userId: ownerId,
        connectionId,
        challengeId,
        encrypted,
        verificationUri: "https://auth.openai.com/codex/device",
        expiresAt: new Date("2026-08-08T12:15:00.000Z"),
        vaultKey,
      }).userCode,
    ).toBe("GS4I-40ZGK");
  });
});
