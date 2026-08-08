import { createPublicKey, generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { workspaceLifecycleInternals } from "./workspace-lifecycle";

describe("workspace lifecycle cryptographic boundaries", () => {
  it("binds a device challenge to the exact owner, connection, and challenge", () => {
    expect(
      workspaceLifecycleInternals.workspaceAuthChallengeAssociatedData(
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
      ),
    ).toBe(
      "trialrun:agent-connection-auth-challenge:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:33333333-3333-4333-8333-333333333333",
    );
  });

  it("derives only the Ed25519 public key shipped to each workspace", () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const encodedPrivateKey = Buffer.from(
      privateKey.export({ format: "pem", type: "pkcs8" }),
    ).toString("base64");
    const derived = workspaceLifecycleInternals.publicSigningKey(encodedPrivateKey);
    const parsed = createPublicKey({
      key: Buffer.from(derived, "base64"),
      format: "der",
      type: "spki",
    });
    expect(parsed.asymmetricKeyType).toBe("ed25519");
  });
});
