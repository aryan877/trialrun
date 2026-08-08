import { describe, expect, it } from "vitest";

import {
  decryptSecret,
  deriveCsrfToken,
  encryptSecret,
  redactText,
  verifyCsrfToken,
  verifyGitHubWebhookSignature,
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
});
