import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { z } from "zod";

export const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

const configSchema = z
  .object({
    DATABASE_URL: z.string().url(),
    EXECUTION_PROVIDER: z.enum(["local", "zerops"]).default("local"),
    ARTIFACT_DRIVER: z.enum(["local", "s3"]).default("local"),
    ARTIFACT_ROOT: z.string().default(".data/artifacts"),
    RUNNER_ID: z
      .string()
      .min(1)
      .max(160)
      .default(`${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`),
    RUNNER_POLL_MS: z.coerce.number().int().min(100).max(30_000).default(750),
    RUNNER_LEASE_SECONDS: z.coerce.number().int().min(30).max(600).default(90),
    RUNNER_JOB_TIMEOUT_SECONDS: z.coerce.number().int().min(30).max(3_600).default(2_400),
    CODEX_ANALYST_ENABLED: z.enum(["true", "false"]).default("true"),
    CODEX_BINARY: z.string().min(1).default("codex"),
    CODEX_MODEL: z.string().min(1).default("gpt-5.6-sol"),
    CODEX_REASONING_EFFORT: z.enum(["low", "medium"]).default("medium"),
    MANAGED_OPENAI_API_KEY: z.string().min(20).optional(),
    MANAGED_CODEX_HOME: z.string().min(1).optional(),
    REPOSITORY_MCP_BIND_HOST: z.enum(["127.0.0.1", "0.0.0.0"]).default("127.0.0.1"),
    REPOSITORY_MCP_PORT: z.coerce.number().int().min(0).max(65_535).default(0),
    REPOSITORY_MCP_PUBLIC_URL: z.string().url().optional(),
    APP_URL: z.string().url().default("http://localhost:3000"),
    GITHUB_APP_ID: z.coerce.number().int().positive().safe().optional(),
    GITHUB_PRIVATE_KEY_BASE64: z.string().min(100).optional(),
    GITHUB_CLIENT_ID: z.string().min(10).optional(),
    GITHUB_CLIENT_SECRET: z.string().min(20).optional(),
    VAULT_KEY_BASE64: z.string().optional(),
    VAULT_KEY_VERSION: z.coerce.number().int().positive().default(1),
    TRIALRUN_ZEROPS_API_URL: z
      .string()
      .url()
      .default("https://api.app-prg1.zerops.io/api/rest/public"),
    TRIALRUN_ZEROPS_ACCESS_TOKEN: z.string().optional(),
    TRIALRUN_ZEROPS_CLIENT_ID: z.string().optional(),
    TRIALRUN_ZEROPS_EXECUTOR_SOURCE_DIRECTORY: z
      .string()
      .trim()
      .min(
        1,
        "TRIALRUN_ZEROPS_EXECUTOR_SOURCE_DIRECTORY must identify the deployed executor bundle.",
      )
      .max(4_096)
      .default("."),
    TRIALRUN_CODEX_WORKSPACE_SOURCE_DIRECTORY: z
      .string()
      .trim()
      .min(1)
      .max(4_096)
      .default(".deploy/codex-workspace-source"),
    TRIALRUN_BRIDGE_SIGNING_PRIVATE_KEY_BASE64: z.string().min(64).optional(),
    ZCLI_BINARY: z.string().min(1).default("zcli"),
    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().default("us-east-1"),
    S3_BUCKET: z.string().default("trialrun-evidence"),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("true"),
  })
  .superRefine((value, context) => {
    if (
      value.EXECUTION_PROVIDER === "zerops" &&
      (!value.TRIALRUN_ZEROPS_ACCESS_TOKEN || !value.TRIALRUN_ZEROPS_CLIENT_ID)
    ) {
      context.addIssue({
        code: "custom",
        message: "Zerops mode requires an access token and client ID.",
      });
    }
    if (
      value.EXECUTION_PROVIDER === "zerops" &&
      (!value.TRIALRUN_BRIDGE_SIGNING_PRIVATE_KEY_BASE64 ||
        !value.VAULT_KEY_BASE64 ||
        !value.REPOSITORY_MCP_PUBLIC_URL)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Zerops mode requires the workspace bridge signing key, vault key, and public repository tool URL.",
      });
    }
    if (Boolean(value.GITHUB_APP_ID) !== Boolean(value.GITHUB_PRIVATE_KEY_BASE64)) {
      context.addIssue({ code: "custom", message: "GitHub App ID and private key must be configured together." });
    }
    if (
      value.ARTIFACT_DRIVER === "s3" &&
      (!value.S3_ACCESS_KEY_ID || !value.S3_SECRET_ACCESS_KEY)
    ) {
      context.addIssue({ code: "custom", message: "S3 mode requires access key credentials." });
    }
    if (
      value.REPOSITORY_MCP_PUBLIC_URL &&
      (value.REPOSITORY_MCP_BIND_HOST !== "0.0.0.0" || value.REPOSITORY_MCP_PORT === 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "A public repository MCP proxy requires a fixed private 0.0.0.0 listener.",
      });
    }
  });

export const runnerConfig = configSchema.parse(process.env);
