import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { hashToken } from "@trialrun/domain";

import type { AuthContext } from "./auth";
import { csrfKey } from "./env";

const statePayloadSchema = z.object({
  userId: z.string().uuid(),
  sessionHash: z.string().regex(/^[0-9a-f]{64}$/),
  expiresAt: z.number().int().positive(),
  nonce: z.string().min(20).max(100),
});

function signature(payload: string): string {
  return createHmac("sha256", csrfKey()).update(`trialrun-github:${payload}`).digest("base64url");
}

export function createGitHubState(auth: AuthContext): string {
  const payload = Buffer.from(
    JSON.stringify({
      userId: auth.user.id,
      sessionHash: hashToken(auth.sessionToken),
      expiresAt: Date.now() + 10 * 60_000,
      nonce: randomBytes(24).toString("base64url"),
    }),
    "utf8",
  ).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function verifyGitHubState(auth: AuthContext, state: string): void {
  const [payload, suppliedSignature, extra] = state.split(".");
  if (!payload || !suppliedSignature || extra) throw new Error("GitHub state is malformed.");
  const expected = Buffer.from(signature(payload), "utf8");
  const supplied = Buffer.from(suppliedSignature, "utf8");
  if (expected.byteLength !== supplied.byteLength || !timingSafeEqual(expected, supplied)) {
    throw new Error("GitHub state signature is invalid.");
  }
  const decodedPayload: unknown = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  );
  const decoded = statePayloadSchema.parse(decodedPayload);
  if (
    decoded.userId !== auth.user.id ||
    decoded.sessionHash !== hashToken(auth.sessionToken) ||
    decoded.expiresAt < Date.now()
  ) {
    throw new Error("GitHub state is expired or belongs to another session.");
  }
}
