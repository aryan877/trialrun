import { generateKeyPairSync, randomBytes, sign } from "node:crypto";

import { describe, expect, it } from "vitest";

import { RequestVerifier, requestSigningPayload } from "./protocol";

describe("workspace bridge request authentication", () => {
  it("accepts one action-scoped Ed25519 request and rejects replay", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const now = 1_800_000_000_000;
    const timestamp = Math.floor(now / 1_000);
    const nonce = randomBytes(16).toString("hex");
    const body = Buffer.from("{}", "utf8");
    const audience = "agent-connection:11111111-1111-4111-8111-111111111111";
    const signature = sign(
      null,
      requestSigningPayload({ audience, method: "POST", pathname: "/v1/login/start", timestamp, nonce, body }),
      privateKey,
    ).toString("base64");
    const verifier = new RequestVerifier(
      publicKey.export({ format: "der", type: "spki" }).toString("base64"),
      audience,
      () => now,
    );
    const request = {
      method: "POST",
      pathname: "/v1/login/start",
      body,
      headers: {
        "x-trialrun-timestamp": String(timestamp),
        "x-trialrun-nonce": nonce,
        "x-trialrun-signature": signature,
        "x-trialrun-audience": audience,
      },
    } as const;
    expect(() => verifier.verify(request)).not.toThrow();
    expect(() => verifier.verify(request)).toThrow(/already used/);
  });

  it("rejects a signature copied to a different action", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const now = 1_800_000_000_000;
    const timestamp = Math.floor(now / 1_000);
    const nonce = randomBytes(16).toString("hex");
    const body = new Uint8Array();
    const audience = "agent-connection:22222222-2222-4222-8222-222222222222";
    const signature = sign(
      null,
      requestSigningPayload({ audience, method: "GET", pathname: "/v1/login/status", timestamp, nonce, body }),
      privateKey,
    ).toString("base64");
    const verifier = new RequestVerifier(
      publicKey.export({ format: "der", type: "spki" }).toString("base64"),
      audience,
      () => now,
    );
    expect(() =>
      verifier.verify({
        method: "POST",
        pathname: "/v1/login/cancel",
        body,
        headers: {
          "x-trialrun-timestamp": String(timestamp),
          "x-trialrun-nonce": nonce,
          "x-trialrun-signature": signature,
          "x-trialrun-audience": audience,
        },
      }),
    ).toThrow(/signature is invalid/);
  });

  it("rejects a valid signature addressed to another workspace", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const now = 1_800_000_000_000;
    const timestamp = Math.floor(now / 1_000);
    const nonce = randomBytes(16).toString("hex");
    const body = new Uint8Array();
    const expectedAudience = "agent-connection:33333333-3333-4333-8333-333333333333";
    const otherAudience = "agent-connection:44444444-4444-4444-8444-444444444444";
    const signature = sign(
      null,
      requestSigningPayload({
        audience: otherAudience,
        method: "GET",
        pathname: "/v1/login/status",
        timestamp,
        nonce,
        body,
      }),
      privateKey,
    ).toString("base64");
    const verifier = new RequestVerifier(
      publicKey.export({ format: "der", type: "spki" }).toString("base64"),
      expectedAudience,
      () => now,
    );
    expect(() =>
      verifier.verify({
        method: "GET",
        pathname: "/v1/login/status",
        body,
        headers: {
          "x-trialrun-timestamp": String(timestamp),
          "x-trialrun-nonce": nonce,
          "x-trialrun-signature": signature,
          "x-trialrun-audience": otherAudience,
        },
      }),
    ).toThrow(/audience does not match/);
  });
});
