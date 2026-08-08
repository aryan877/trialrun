import { describe, expect, it } from "vitest";

import {
  emptyWorkspaceConnectionMetadata,
  workspaceConnectionActionSchema,
  workspaceConnectionApiResponseSchema,
} from "./contract";

const csrfToken = "csrf-token-long-enough-for-validation";

describe("Codex workspace API contract", () => {
  it("accepts only exact lifecycle actions", () => {
    for (const intent of ["connect", "verify", "retry", "revoke"] as const) {
      expect(workspaceConnectionActionSchema.parse({ intent, csrfToken })).toEqual({
        intent,
        csrfToken,
      });
    }
    for (const invalid of [
      { intent: "connect" },
      { intent: "connect", csrfToken, connectionId: "owner-controlled-ids-are-forbidden" },
      { intent: "delete", csrfToken },
    ]) {
      expect(workspaceConnectionActionSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("returns only lifecycle metadata and the short-lived verification challenge", () => {
    const response = workspaceConnectionApiResponseSchema.parse({
      ok: true,
      workspace: {
        ...emptyWorkspaceConnectionMetadata(),
        configured: true,
        status: "awaiting_auth",
        operation: null,
        updatedAt: "2026-08-08T12:00:00.000Z",
        verification: {
          verificationUri: "https://auth.openai.com/codex/device",
          userCode: "ABCD-1234",
          expiresAt: "2026-08-08T12:15:00.000Z",
        },
      },
    });
    expect(response).toMatchObject({ ok: true, workspace: { status: "awaiting_auth" } });
    expect(JSON.stringify(response)).not.toMatch(
      /authTag|ciphertext|ownership|bridge|zcp|lastError|auth\.json/i,
    );
  });
});
