import { createHash, createPublicKey, timingSafeEqual, verify } from "node:crypto";

import { z } from "zod";

const timestampSchema = z.coerce.number().int().positive();
const nonceSchema = z.string().regex(/^[0-9a-f]{32}$/);
const signatureSchema = z.base64();
const audienceSchema = z.string().regex(/^agent-connection:[0-9a-f-]{36}$/);
const maximumClockSkewSeconds = 60;

export interface SignedRequest {
  readonly method: string;
  readonly pathname: string;
  readonly body: Uint8Array;
  readonly headers: Readonly<Record<string, string | undefined>>;
}

export class RequestVerifier {
  readonly #publicKey: ReturnType<typeof createPublicKey>;
  readonly #audience: string;
  readonly #seenNonces = new Map<string, number>();
  readonly #now: () => number;

  constructor(publicKeyDerBase64: string, audience: string, now: () => number = Date.now) {
    const der = z.base64().parse(publicKeyDerBase64);
    this.#publicKey = createPublicKey({
      key: Buffer.from(der, "base64"),
      format: "der",
      type: "spki",
    });
    if (this.#publicKey.asymmetricKeyType !== "ed25519") {
      throw new Error("TrialRun bridge requires an Ed25519 signing key.");
    }
    this.#audience = audienceSchema.parse(audience);
    this.#now = now;
  }

  verify(request: SignedRequest): void {
    const timestamp = timestampSchema.parse(request.headers["x-trialrun-timestamp"]);
    const nonce = nonceSchema.parse(request.headers["x-trialrun-nonce"]);
    const audience = audienceSchema.parse(request.headers["x-trialrun-audience"]);
    if (audience !== this.#audience) {
      throw new Error("The bridge request audience does not match this workspace.");
    }
    const signature = Buffer.from(
      signatureSchema.parse(request.headers["x-trialrun-signature"]),
      "base64",
    );
    const nowSeconds = Math.floor(this.#now() / 1_000);
    if (Math.abs(nowSeconds - timestamp) > maximumClockSkewSeconds) {
      throw new Error("The bridge request timestamp is outside the allowed window.");
    }
    for (const [seenNonce, expiresAt] of this.#seenNonces) {
      if (expiresAt < nowSeconds) this.#seenNonces.delete(seenNonce);
    }
    if (this.#seenNonces.has(nonce)) throw new Error("The bridge request nonce was already used.");

    const bodyHash = createHash("sha256").update(request.body).digest("hex");
    const message = Buffer.from(
      [audience, request.method.toUpperCase(), request.pathname, String(timestamp), nonce, bodyHash].join("\n"),
      "utf8",
    );
    if (!verify(null, message, this.#publicKey, signature)) {
      const constantTimeNoise = Buffer.from(createHash("sha256").update(signature).digest());
      timingSafeEqual(constantTimeNoise, constantTimeNoise);
      throw new Error("The bridge request signature is invalid.");
    }
    this.#seenNonces.set(nonce, nowSeconds + maximumClockSkewSeconds);
  }
}

export function requestSigningPayload(input: {
  readonly audience: string;
  readonly method: string;
  readonly pathname: string;
  readonly timestamp: number;
  readonly nonce: string;
  readonly body: Uint8Array;
}): Uint8Array {
  const audience = audienceSchema.parse(input.audience);
  const bodyHash = createHash("sha256").update(input.body).digest("hex");
  return Buffer.from(
    [
      audience,
      input.method.toUpperCase(),
      input.pathname,
      String(input.timestamp),
      input.nonce,
      bodyHash,
    ].join("\n"),
    "utf8",
  );
}
