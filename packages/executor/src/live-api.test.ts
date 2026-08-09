import { describe, expect, it } from "vitest";

import {
  LiveApiContractError,
  evaluateLiveApiAssertion,
  liveApiAssertionSchema,
  liveApiRequestSchema,
  redactLiveApiText,
  resolveLiveApiRequest,
} from "./live-api";

const canaryOne = "canary-api-password-one";
const canaryTwo = "canary-api-token-two";
const secrets = { TEST_PASSWORD: canaryOne, TEST_TOKEN: canaryTwo };

describe("live API contract", () => {
  it("accepts dynamic relative paths and every supported method", () => {
    for (const method of ["DELETE", "GET", "PATCH", "POST", "PUT"] as const) {
      expect(
        liveApiRequestSchema.safeParse({ method, path: "/api/orders/42?include=lines" }).success,
      ).toBe(true);
    }
  });

  it("rejects paths that can escape or confuse the assigned origin", () => {
    for (const path of [
      "https://evil.test/api",
      "//evil.test/api",
      "/\\evil.test/api",
      "/api#fragment",
      "/api\u0000hidden",
    ]) {
      expect(liveApiRequestSchema.safeParse({ method: "GET", path }).success).toBe(false);
    }
  });

  it("rejects duplicate, transport-controlled, and GET-body inputs", () => {
    expect(
      liveApiRequestSchema.safeParse({
        method: "POST",
        path: "/api",
        headers: [
          { name: "X-Test", value: { kind: "literal", value: "a" } },
          { name: "x-test", value: { kind: "literal", value: "b" } },
        ],
      }).success,
    ).toBe(false);
    expect(
      liveApiRequestSchema.safeParse({
        method: "POST",
        path: "/api",
        headers: [{ name: "Cookie", value: { kind: "literal", value: "unsafe" } }],
      }).success,
    ).toBe(false);
    expect(
      liveApiRequestSchema.safeParse({
        method: "GET",
        path: "/api",
        body: { kind: "text", value: { kind: "literal", value: "body" } },
      }).success,
    ).toBe(false);
  });

  it("resolves named secrets without exposing their values in evidence summaries", () => {
    const request = liveApiRequestSchema.parse({
      method: "POST",
      path: "/api/login",
      headers: [{ name: "Authorization", value: { kind: "secret", name: "TEST_TOKEN" } }],
      body: {
        kind: "json_fields",
        fields: {
          email: { kind: "literal", value: "judge@example.test" },
          password: { kind: "secret", name: "TEST_PASSWORD" },
        },
      },
    });
    const resolved = resolveLiveApiRequest(request, secrets);

    expect(resolved.headers.Authorization).toBe(canaryTwo);
    expect(resolved.body).toContain(canaryOne);
    expect(resolved.secretNames).toEqual(["TEST_PASSWORD", "TEST_TOKEN"]);
    const summary = JSON.stringify(resolved.evidenceSummary);
    expect(summary).toContain("TEST_PASSWORD");
    expect(summary).toContain("TEST_TOKEN");
    expect(summary).not.toContain(canaryOne);
    expect(summary).not.toContain(canaryTwo);
    expect(summary).not.toContain("judge@example.test");
  });

  it("rejects missing secrets and bodies above 64 KiB without echoing values", () => {
    const missing = liveApiRequestSchema.parse({
      method: "POST",
      path: "/api",
      body: { kind: "text", value: { kind: "secret", name: "MISSING_SECRET" } },
    });
    expect(() => resolveLiveApiRequest(missing, secrets)).toThrowError(
      expect.objectContaining({ code: "SECRET_NOT_APPROVED" }),
    );

    const atLimit = liveApiRequestSchema.parse({
      method: "POST",
      path: "/api",
      body: { kind: "text", value: { kind: "secret", name: "REQUEST_BODY" } },
    });
    expect(
      resolveLiveApiRequest(atLimit, { REQUEST_BODY: "a".repeat(64 * 1_024) }).body,
    ).toHaveLength(64 * 1_024);
    expect(() =>
      resolveLiveApiRequest(atLimit, { REQUEST_BODY: "a".repeat(64 * 1_024 + 1) }),
    ).toThrow("64 KiB");
  });

  it("evaluates status, body, and JSON scalar assertions deterministically", () => {
    const response = {
      status: 200,
      bodyText: JSON.stringify({ cart: { total: 36, ok: true } }),
      bodyTruncated: false,
      contentType: "application/json; charset=utf-8",
    };
    expect(evaluateLiveApiAssertion(response, { kind: "status", equals: 200 }).passed).toBe(true);
    expect(
      evaluateLiveApiAssertion(response, { kind: "body_includes", includes: '"ok":true' }).passed,
    ).toBe(true);
    expect(
      evaluateLiveApiAssertion(response, {
        kind: "json_path_equals",
        path: ["cart", "total"],
        equals: 36,
      }).passed,
    ).toBe(true);
    expect(
      evaluateLiveApiAssertion(response, {
        kind: "json_path_equals",
        path: ["cart", "total"],
        equals: 37,
      }).passed,
    ).toBe(false);
  });

  it("rejects weak JSON evidence and unsafe traversal", () => {
    const assertion = liveApiAssertionSchema.parse({
      kind: "json_path_equals",
      path: ["cart", "total"],
      equals: 36,
    });
    expect(() =>
      evaluateLiveApiAssertion(
        { status: 200, bodyText: "{}", bodyTruncated: true, contentType: "application/json" },
        assertion,
      ),
    ).toThrow("truncated");
    expect(() =>
      evaluateLiveApiAssertion(
        { status: 200, bodyText: "not-json", bodyTruncated: false, contentType: "text/plain" },
        assertion,
      ),
    ).toThrow("JSON response content type");
    expect(() =>
      evaluateLiveApiAssertion(
        { status: 200, bodyText: "{}", bodyTruncated: false, contentType: "application/json" },
        assertion,
      ),
    ).toThrow("not present");
    expect(
      liveApiAssertionSchema.safeParse({
        kind: "json_path_equals",
        path: ["__proto__"],
        equals: "polluted",
      }).success,
    ).toBe(false);
  });

  it("redacts canary secrets from response text and safe errors", () => {
    expect(redactLiveApiText(`${canaryOne} ${canaryTwo}`, [canaryOne, canaryTwo])).toBe(
      "[REDACTED] [REDACTED]",
    );
    try {
      resolveLiveApiRequest(
        liveApiRequestSchema.parse({
          method: "POST",
          path: "/api",
          body: { kind: "text", value: { kind: "secret", name: "MISSING" } },
        }),
        secrets,
      );
    } catch (error) {
      expect(error).toBeInstanceOf(LiveApiContractError);
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(canaryOne);
      expect(message).not.toContain(canaryTwo);
    }
  });
});
