import { describe, expect, it } from "vitest";

import {
  deleteOpenAiConnectionSchema,
  openAiConnectionMetadata,
  putOpenAiConnectionSchema,
  WorkspaceConnectionManagedSeparatelyError,
} from "./contract";

const csrfToken = "csrf-token-long-enough-for-validation";

describe("OpenAI connection API contract", () => {
  it("accepts only the two exact supported write shapes", () => {
    expect(putOpenAiConnectionSchema.parse({ mode: "managed", csrfToken })).toEqual({
      mode: "managed",
      csrfToken,
    });
    expect(
      putOpenAiConnectionSchema.parse({
        mode: "api_key",
        csrfToken,
        apiKey: "sk-test-value-that-is-long-enough",
      }),
    ).toEqual({
      mode: "api_key",
      csrfToken,
      apiKey: "sk-test-value-that-is-long-enough",
    });
    for (const invalid of [
      { mode: "managed", csrfToken, apiKey: "must-not-be-accepted" },
      { mode: "api_key", csrfToken, apiKey: "contains whitespace" },
      { mode: "codex_workspace", csrfToken },
      { mode: "managed" },
    ]) {
      expect(putOpenAiConnectionSchema.safeParse(invalid).success).toBe(false);
    }
    expect(deleteOpenAiConnectionSchema.safeParse({ csrfToken, extra: true }).success).toBe(false);
  });

  it("returns metadata without durable identity or encrypted material", () => {
    const source = {
      id: "11111111-1111-4111-8111-111111111111",
      mode: "api_key" as const,
      status: "connected" as const,
      updatedAt: new Date("2026-08-08T12:00:00.000Z"),
      lastVerifiedAt: null,
      keyVersion: 7,
      iv: "private-iv",
      ciphertext: "private-ciphertext",
      authTag: "private-auth-tag",
    };
    expect(openAiConnectionMetadata(source)).toEqual({
      provider: "openai",
      configured: true,
      mode: "api_key",
      status: "connected",
      updatedAt: "2026-08-08T12:00:00.000Z",
      lastVerifiedAt: null,
    });
  });

  it("represents revocation without claiming a selected mode", () => {
    expect(
      openAiConnectionMetadata({
        mode: "managed",
        status: "revoked",
        updatedAt: new Date("2026-08-08T12:00:00.000Z"),
        lastVerifiedAt: null,
      }),
    ).toMatchObject({ configured: false, mode: null, status: "revoked" });
  });

  it("keeps subscription workspace records outside this API", () => {
    expect(() =>
      openAiConnectionMetadata({
        mode: "codex_workspace",
        status: "connected",
        updatedAt: new Date(),
        lastVerifiedAt: new Date(),
      }),
    ).toThrow(WorkspaceConnectionManagedSeparatelyError);
  });
});
