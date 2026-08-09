import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export interface EncryptedSecret {
  readonly keyVersion: number;
  readonly iv: string;
  readonly ciphertext: string;
  readonly authTag: string;
}

function assertAesKey(key: Uint8Array): void {
  if (key.byteLength !== 32) {
    throw new Error("The vault key must contain exactly 32 bytes.");
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const publicProofTokenPattern = /^p1_[A-Za-z0-9_-]{43}$/;

function publicProofSigningKey(vaultKey: Uint8Array): Buffer {
  assertAesKey(vaultKey);
  return createHmac("sha256", vaultKey).update("trialrun:public-proof:v1:key", "utf8").digest();
}

export function derivePublicProofToken(reviewId: string, vaultKey: Uint8Array): string {
  if (!uuidPattern.test(reviewId)) throw new Error("A public proof requires an exact review ID.");
  const digest = createHmac("sha256", publicProofSigningKey(vaultKey))
    .update(`trialrun:public-proof:v1:review:${reviewId.toLowerCase()}`, "utf8")
    .digest("base64url");
  return `p1_${digest}`;
}

export function verifyPublicProofToken(
  reviewId: string,
  token: string,
  vaultKey: Uint8Array,
): boolean {
  if (!uuidPattern.test(reviewId) || !publicProofTokenPattern.test(token)) return false;
  const expected = Buffer.from(derivePublicProofToken(reviewId, vaultKey), "utf8");
  const actual = Buffer.from(token, "utf8");
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
}

export function decodeBase64Key(value: string, label: string): Buffer {
  const key = Buffer.from(value, "base64");
  if (key.byteLength !== 32) {
    throw new Error(`${label} must be a base64-encoded 32-byte value.`);
  }
  return key;
}

export function encryptSecret(
  plaintext: string,
  key: Uint8Array,
  keyVersion: number,
  associatedData: string,
): EncryptedSecret {
  assertAesKey(key);
  if (plaintext.length === 0) {
    throw new Error("Empty secret values are not stored.");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(associatedData, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    keyVersion,
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(
  encrypted: EncryptedSecret,
  key: Uint8Array,
  associatedData: string,
): string {
  assertAesKey(key);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encrypted.iv, "base64"));
  decipher.setAAD(Buffer.from(associatedData, "utf8"));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function deriveCsrfToken(sessionToken: string, csrfSecret: Uint8Array): string {
  return createHmac("sha256", csrfSecret)
    .update(`trialrun-csrf:${sessionToken}`)
    .digest("base64url");
}

export function verifyCsrfToken(
  sessionToken: string,
  suppliedToken: string,
  csrfSecret: Uint8Array,
): boolean {
  const expected = Buffer.from(deriveCsrfToken(sessionToken, csrfSecret));
  const actual = Buffer.from(suppliedToken);
  return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual);
}

export function verifyGitHubWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  webhookSecret: string,
): boolean {
  if (!signatureHeader?.startsWith("sha256=") || webhookSecret.length === 0) {
    return false;
  }
  const expected = Buffer.from(
    `sha256=${createHmac("sha256", webhookSecret).update(rawBody, "utf8").digest("hex")}`,
  );
  const actual = Buffer.from(signatureHeader);
  return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual);
}

function redactVariants(secret: string): readonly string[] {
  const variants = new Set([secret]);
  try {
    variants.add(encodeURIComponent(secret));
  } catch {
    // The exact value is still redacted when URI encoding cannot represent it.
  }
  if (secret.length >= 8) {
    variants.add(Buffer.from(secret, "utf8").toString("base64"));
  }
  return [...variants].filter((value) => value.length > 0);
}

function sortedRedactionVariants(secrets: readonly string[]): readonly string[] {
  return secrets
    .filter((secret) => secret.length > 0)
    .flatMap(redactVariants)
    .sort((left, right) => right.length - left.length);
}

function redactVariantsFromText(input: string, variants: readonly string[]): string {
  let output = input;
  for (const secret of variants) {
    output = output.split(secret).join("[REDACTED]");
  }
  return output;
}

export function redactText(input: string, secrets: readonly string[]): string {
  return redactVariantsFromText(input, sortedRedactionVariants(secrets));
}

export function redactTruncatedText(input: string, secrets: readonly string[]): string {
  const variants = sortedRedactionVariants(secrets);
  let unsafeSuffixLength = 0;
  for (const variant of variants) {
    const maximum = Math.min(input.length, variant.length - 1);
    for (let length = maximum; length > unsafeSuffixLength; length -= 1) {
      if (input.endsWith(variant.slice(0, length))) {
        unsafeSuffixLength = length;
        break;
      }
    }
  }
  const safeInput =
    unsafeSuffixLength === 0 ? input : `${input.slice(0, -unsafeSuffixLength)}[REDACTED]`;
  return redactVariantsFromText(safeInput, variants);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase("en-US");
}
