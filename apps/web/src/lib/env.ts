import "server-only";

import { existsSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";

import { z } from "zod";

function findWorkspaceRoot(startDirectory: string): string {
  let directory = resolve(startDirectory);
  const filesystemRoot = parse(directory).root;
  while (directory !== filesystemRoot) {
    if (existsSync(resolve(directory, "pnpm-workspace.yaml"))) return directory;
    directory = dirname(directory);
  }
  return resolve(startDirectory);
}

export const workspaceRoot = findWorkspaceRoot(process.cwd());
const rootEnvPath = resolve(workspaceRoot, ".env");
if (existsSync(rootEnvPath)) process.loadEnvFile(rootEnvPath);

function emptyStringToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

const optionalString = z.preprocess(
  emptyStringToUndefined,
  z.string().min(1).max(4_096).optional(),
);
const optionalUrl = z.preprocess(emptyStringToUndefined, z.string().max(2_048).url().optional());

function selectedArtifactDriver(value: {
  readonly ARTIFACT_DRIVER?: "local" | "s3" | undefined;
  readonly S3_ENDPOINT?: string | undefined;
  readonly S3_ACCESS_KEY_ID?: string | undefined;
  readonly S3_SECRET_ACCESS_KEY?: string | undefined;
}): "local" | "s3" {
  if (value.ARTIFACT_DRIVER) return value.ARTIFACT_DRIVER;
  return value.S3_ENDPOINT || value.S3_ACCESS_KEY_ID || value.S3_SECRET_ACCESS_KEY ? "s3" : "local";
}

const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().url().default("postgres://trialrun:trialrun@127.0.0.1:55432/trialrun"),
    APP_URL: z.string().url().default("http://localhost:3000"),
    RUNNER_REPOSITORY_MCP_URL: z
      .url()
      .refine((value) => {
        const url = new URL(value);
        return (
          url.protocol === "http:" &&
          ["127.0.0.1", "localhost", "runner"].includes(url.hostname) &&
          url.pathname === "/mcp" &&
          url.search === "" &&
          url.hash === "" &&
          url.username === "" &&
          url.password === ""
        );
      }, "RUNNER_REPOSITORY_MCP_URL must point to the private runner MCP endpoint.")
      .default("http://127.0.0.1:3001/mcp"),
    CSRF_SECRET_BASE64: z.string().optional(),
    VAULT_KEY_BASE64: z.string().optional(),
    VAULT_KEY_VERSION: z.coerce.number().int().positive().default(1),
    EXECUTION_PROVIDER: z.enum(["local", "zerops"]).default("local"),
    GITHUB_APP_ID: z.coerce.number().int().positive().safe().optional(),
    GITHUB_PRIVATE_KEY_BASE64: z.string().min(100).optional(),
    GITHUB_CLIENT_ID: z.string().min(10).optional(),
    GITHUB_CLIENT_SECRET: z.string().min(20).optional(),
    GITHUB_WEBHOOK_SECRET: z.string().min(20).optional(),
    ARTIFACT_DRIVER: z.enum(["local", "s3"]).optional(),
    ARTIFACT_ROOT: z.string().trim().min(1).default(".data/artifacts"),
    S3_ENDPOINT: optionalUrl,
    S3_REGION: z.string().trim().min(1).max(80).default("us-east-1"),
    S3_BUCKET: z
      .string()
      .trim()
      .min(3)
      .max(63)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$/)
      .default("trialrun-evidence"),
    S3_ACCESS_KEY_ID: optionalString,
    S3_SECRET_ACCESS_KEY: optionalString,
    S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("true"),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === "production" && !value.CSRF_SECRET_BASE64) {
      context.addIssue({ code: "custom", message: "Production requires CSRF_SECRET_BASE64." });
    }
    if (Boolean(value.GITHUB_APP_ID) !== Boolean(value.GITHUB_PRIVATE_KEY_BASE64)) {
      context.addIssue({
        code: "custom",
        message: "GitHub App ID and private key must be configured together.",
      });
    }
    if (Boolean(value.GITHUB_CLIENT_ID) !== Boolean(value.GITHUB_CLIENT_SECRET)) {
      context.addIssue({
        code: "custom",
        message: "GitHub OAuth client ID and secret must be configured together.",
      });
    }
    if (
      selectedArtifactDriver(value) === "s3" &&
      (!value.S3_ACCESS_KEY_ID || !value.S3_SECRET_ACCESS_KEY)
    ) {
      context.addIssue({
        code: "custom",
        message: "S3 artifact delivery requires access key credentials.",
      });
    }
  })
  .transform((value) => ({ ...value, ARTIFACT_DRIVER: selectedArtifactDriver(value) }));

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  cached ??= serverEnvSchema.parse(process.env);
  return cached;
}

export function csrfKey(): Buffer {
  const configured = serverEnv().CSRF_SECRET_BASE64;
  if (!configured && serverEnv().NODE_ENV !== "production") {
    return Buffer.from("trialrun-local-csrf-key-32-bytes", "utf8");
  }
  const key = Buffer.from(configured ?? "", "base64");
  if (key.byteLength !== 32) throw new Error("CSRF_SECRET_BASE64 must contain exactly 32 bytes.");
  return key;
}
