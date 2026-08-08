import { z } from "zod";

const privateApplicationUrlSchema = z
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === ""
    );
  }, "Expected a credential-free internal HTTP origin without a path.");

const executorConfigSchema = z.strictObject({
  HOST: z.enum(["0.0.0.0", "127.0.0.1"]).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1_024).max(65_535).default(3_000),
  TRIALRUN_EXECUTION_TOKEN: z.string().min(32).max(1_024),
  TRIALRUN_REVIEW_ID: z.string().uuid(),
  TRIALRUN_BASE_URL: privateApplicationUrlSchema,
  TRIALRUN_HEAD_URL: privateApplicationUrlSchema,
  TRIALRUN_TEST_SECRETS_BASE64: z.string().max(8_000).default("e30="),
});

const secretNameSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/);
const testSecretsSchema = z.record(secretNameSchema, z.string().min(1).max(32_768));

export interface CloudExecutorConfig {
  readonly host: string;
  readonly port: number;
  readonly executionToken: string;
  readonly reviewId: string;
  readonly origins: Readonly<Record<"base" | "head", string>>;
  readonly secrets: Readonly<Record<string, string>>;
}

export function loadCloudExecutorConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): CloudExecutorConfig {
  const parsed = executorConfigSchema.parse(environment);
  let decodedSecrets: unknown;
  try {
    decodedSecrets = JSON.parse(
      Buffer.from(parsed.TRIALRUN_TEST_SECRETS_BASE64, "base64").toString("utf8"),
    );
  } catch {
    throw new Error("TRIALRUN_TEST_SECRETS_BASE64 is not a valid encoded JSON object.");
  }
  const secrets = testSecretsSchema.parse(decodedSecrets);
  return {
    host: parsed.HOST,
    port: parsed.PORT,
    executionToken: parsed.TRIALRUN_EXECUTION_TOKEN,
    reviewId: parsed.TRIALRUN_REVIEW_ID,
    origins: {
      base: new URL(parsed.TRIALRUN_BASE_URL).origin,
      head: new URL(parsed.TRIALRUN_HEAD_URL).origin,
    },
    secrets: { ...secrets },
  };
}
