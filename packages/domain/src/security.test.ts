import { describe, expect, it } from "vitest";

import {
  decryptSecret,
  derivePublicProofToken,
  deriveCsrfToken,
  encryptSecret,
  redactText,
  redactTruncatedText,
  verifyCsrfToken,
  verifyGitHubWebhookSignature,
  verifyPublicProofToken,
} from "./security";

describe("security primitives", () => {
  it("encrypts with repository/name-bound authenticated data", () => {
    const key = Buffer.alloc(32, 7);
    const encrypted = encryptSecret("not-production", key, 1, "repo-1:TEST_TOKEN");
    expect(decryptSecret(encrypted, key, "repo-1:TEST_TOKEN")).toBe("not-production");
    expect(() => decryptSecret(encrypted, key, "repo-2:TEST_TOKEN")).toThrow();
  });

  it("matches GitHub's published HMAC-SHA256 test vector", () => {
    expect(
      verifyGitHubWebhookSignature(
        "Hello, World!",
        "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17",
        "It's a Secret to Everybody",
      ),
    ).toBe(true);
  });

  it("derives a session-bound CSRF token", () => {
    const key = Buffer.alloc(32, 9);
    const token = deriveCsrfToken("session-a", key);
    expect(verifyCsrfToken("session-a", token, key)).toBe(true);
    expect(verifyCsrfToken("session-b", token, key)).toBe(false);
  });

  it("redacts raw, encoded, and base64 secret variants", () => {
    const secret = "test token/123";
    const input = `${secret} ${encodeURIComponent(secret)} ${Buffer.from(secret).toString("base64")}`;
    expect(redactText(input, [secret])).not.toContain("token");
  });

  it("redacts a secret prefix cut off at a bounded-response edge", () => {
    const secret = "secret-boundary-value";
    expect(redactTruncatedText(`${secret.repeat(2)}secr`, [secret])).toBe(
      "[REDACTED][REDACTED][REDACTED]",
    );
  });

  it("scopes an unguessable public proof token to one exact review and vault key", () => {
    const reviewId = "19583e63-93d7-42e9-b512-65206e53e8a4";
    const key = Buffer.alloc(32, 7);
    const token = derivePublicProofToken(reviewId, key);

    expect(token).toMatch(/^p1_[A-Za-z0-9_-]{43}$/);
    expect(verifyPublicProofToken(reviewId, token, key)).toBe(true);
    expect(verifyPublicProofToken("30b799e6-5cba-4053-99d3-22b4d72e552d", token, key)).toBe(false);
    expect(verifyPublicProofToken(reviewId, token, Buffer.alloc(32, 8))).toBe(false);
    expect(verifyPublicProofToken(reviewId, "p1_invalid", key)).toBe(false);
  });
});
