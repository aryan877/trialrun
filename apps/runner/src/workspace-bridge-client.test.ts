import { generateKeyPairSync, verify } from "node:crypto";

import { describe, expect, it } from "vitest";

import { WorkspaceBridgeClient, workspaceBridgeClientInternals } from "./workspace-bridge-client";

describe("workspace bridge client", () => {
  it("signs the exact audience, method, path, nonce, timestamp, and body", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    let verified = false;
    const client = new WorkspaceBridgeClient({
      bridgeUrl: "https://codexworkspace-proof-8787.prg1.zerops.app",
      connectionId: "11111111-1111-4111-8111-111111111111",
      signingPrivateKeyBase64: Buffer.from(
        privateKey.export({ format: "pem", type: "pkcs8" }),
      ).toString("base64"),
      fetchFunction: async (url, init) => {
        await Promise.resolve();
        expect(url).toBe("https://codexworkspace-proof-8787.prg1.zerops.app/v1/probe");
        const headers = new Headers(init?.headers);
        const audience = headers.get("x-trialrun-audience");
        const timestamp = headers.get("x-trialrun-timestamp");
        const nonce = headers.get("x-trialrun-nonce");
        const signature = headers.get("x-trialrun-signature");
        expect(audience).toBe("agent-connection:11111111-1111-4111-8111-111111111111");
        expect(nonce).toMatch(/^[0-9a-f]{32}$/);
        const payload = Buffer.from(
          [
            audience,
            "POST",
            "/v1/probe",
            timestamp,
            nonce,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          ].join("\n"),
          "utf8",
        );
        verified = verify(null, payload, publicKey, Buffer.from(signature ?? "", "base64"));
        return new Response(
          JSON.stringify({
            status: "connected",
            model: "gpt-5.6-sol",
            reasoningEffort: "medium",
            proof: "typed_codex_invocation",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    });

    await expect(client.probe()).resolves.toMatchObject({ status: "connected" });
    expect(verified).toBe(true);
  });

  it("accepts only exact generated Zerops bridge URLs and Ed25519 keys", () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const encoded = Buffer.from(privateKey.export({ format: "pem", type: "pkcs8" })).toString(
      "base64",
    );
    expect(
      workspaceBridgeClientInternals.bridgeBaseUrl(
        "https://codexworkspace-proof-8787.prg1.zerops.app",
      ),
    ).toContain("zerops.app");
    expect(() => workspaceBridgeClientInternals.bridgeBaseUrl("https://example.com")).toThrow(
      /exact HTTPS Zerops/,
    );
    expect(workspaceBridgeClientInternals.parseSigningKey(encoded).asymmetricKeyType).toBe(
      "ed25519",
    );
  });
});
