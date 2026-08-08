import { describe, expect, it } from "vitest";

import { loadCloudExecutorConfig } from "./config";

const validEnvironment = {
  HOST: "0.0.0.0",
  PORT: "3000",
  TRIALRUN_EXECUTION_TOKEN: "t".repeat(48),
  TRIALRUN_REVIEW_ID: "7ed9b4b8-a591-4a35-a71a-9c1dc6b83d4d",
  TRIALRUN_BASE_URL: "http://baseweb:3000",
  TRIALRUN_HEAD_URL: "http://headweb:3000",
};

describe("loadCloudExecutorConfig", () => {
  it("loads exact private origins and named test secrets", () => {
    expect(
      loadCloudExecutorConfig({
        ...validEnvironment,
        TRIALRUN_TEST_SECRETS_BASE64: Buffer.from(
          JSON.stringify({ TEST_CARD_TOKEN: "secret-value" }),
        ).toString("base64"),
      }),
    ).toMatchObject({
      host: "0.0.0.0",
      port: 3_000,
      origins: { base: "http://baseweb:3000", head: "http://headweb:3000" },
      secrets: { TEST_CARD_TOKEN: "secret-value" },
    });
  });

  it("rejects public HTTPS URLs, paths, credentials, and malformed secret names", () => {
    for (const baseUrl of [
      "https://example.com",
      "http://user:pass@baseweb:3000",
      "http://baseweb:3000/admin",
    ]) {
      expect(() =>
        loadCloudExecutorConfig({ ...validEnvironment, TRIALRUN_BASE_URL: baseUrl }),
      ).toThrow();
    }
    expect(() =>
      loadCloudExecutorConfig({
        ...validEnvironment,
        TRIALRUN_TEST_SECRETS_BASE64: Buffer.from(JSON.stringify({ bad: "value" })).toString(
          "base64",
        ),
      }),
    ).toThrow();
  });
});
