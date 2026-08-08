import { decryptSecret, type EncryptedSecret } from "@trialrun/domain";

import { workspaceVerificationSchema } from "./contract";

export function workspaceAuthChallengeAssociatedData(
  userId: string,
  connectionId: string,
  challengeId: string,
): string {
  return `trialrun:agent-connection-auth-challenge:${userId}:${connectionId}:${challengeId}`;
}

export function decryptWorkspaceVerification(input: {
  readonly userId: string;
  readonly connectionId: string;
  readonly challengeId: string;
  readonly encrypted: EncryptedSecret;
  readonly verificationUri: string;
  readonly expiresAt: Date;
  readonly vaultKey: Uint8Array;
}) {
  const userCode = decryptSecret(
    input.encrypted,
    input.vaultKey,
    workspaceAuthChallengeAssociatedData(input.userId, input.connectionId, input.challengeId),
  );
  return workspaceVerificationSchema.parse({
    verificationUri: input.verificationUri,
    userCode,
    expiresAt: input.expiresAt.toISOString(),
  });
}
