import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import { hash } from "@node-rs/argon2";
import { parse, stringify } from "yaml";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const workspace = new URL("../", import.meta.url);
const secretsDirectory = new URL(".data/secrets/", workspace);
const liveDirectory = new URL(".data/live/", workspace);
const stateUrl = new URL("persistent-deployment.json", secretsDirectory);
const outputUrl = new URL("zerops-project-import.yaml", liveDirectory);

const base64Key = z.string().refine((value) => Buffer.from(value, "base64").byteLength === 32, {
  message: "Expected a base64-encoded 32-byte key.",
});
const deploymentStateSchema = z.strictObject({
  csrfSecretBase64: base64Key,
  vaultKeyBase64: base64Key,
  judgeEmail: z.email().max(320),
  judgePassword: z.string().min(20).max(128),
  judgePasswordHash: z.string().startsWith("$argon2"),
});
type DeploymentState = z.infer<typeof deploymentStateSchema>;

const serviceSchema = z
  .object({
    hostname: z.string(),
    envSecrets: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();
const importSchema = z
  .object({
    services: z.array(serviceSchema),
  })
  .passthrough();
const userInfoSchema = z.object({
  clientUserList: z.array(
    z.object({
      clientId: z.string().min(1),
      status: z.string(),
    }),
  ),
});

async function keychainSecret(service: string): Promise<string> {
  const { stdout } = await execFileAsync("security", [
    "find-generic-password",
    "-s",
    service,
    "-a",
    "trialrun",
    "-w",
  ]);
  const value = stdout.trim();
  if (value.length < 20) throw new Error(`Keychain item ${service} is missing or invalid.`);
  return value;
}

async function loadOrCreateState(): Promise<DeploymentState> {
  try {
    return deploymentStateSchema.parse(JSON.parse(await readFile(stateUrl, "utf8")));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }

  const judgePassword = randomBytes(18).toString("base64url");
  const state = deploymentStateSchema.parse({
    csrfSecretBase64: randomBytes(32).toString("base64"),
    vaultKeyBase64: randomBytes(32).toString("base64"),
    judgeEmail: "judge@trialrun.aryankumar.dev",
    judgePassword,
    judgePasswordHash: await hash(judgePassword, {
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
    }),
  });
  await mkdir(secretsDirectory, { recursive: true, mode: 0o700 });
  await writeFile(stateUrl, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return state;
}

async function zeropsClientId(accessToken: string): Promise<string> {
  let response: Response | undefined;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await fetch("https://api.app-prg1.zerops.io/api/rest/public/user/info", {
        headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15_000),
      });
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!response) throw new Error("Zerops user-info preflight was unreachable.", { cause: lastError });
  if (!response.ok) throw new Error(`Zerops user-info preflight returned HTTP ${response.status}.`);
  const userInfo = userInfoSchema.parse(await response.json());
  const activeClients = userInfo.clientUserList.filter(({ status }) => status === "ACTIVE");
  if (activeClients.length !== 1) {
    throw new Error(`Expected exactly one active Zerops client, received ${activeClients.length}.`);
  }
  const [client] = activeClients;
  if (!client) throw new Error("The active Zerops client disappeared during validation.");
  return client.clientId;
}

function requireService(
  document: z.infer<typeof importSchema>,
  hostname: string,
): z.infer<typeof serviceSchema> {
  const matches = document.services.filter((service) => service.hostname === hostname);
  if (matches.length !== 1) throw new Error(`Expected exactly one ${hostname} service.`);
  const [service] = matches;
  if (!service) throw new Error(`The ${hostname} service disappeared during validation.`);
  return service;
}

async function main(): Promise<void> {
  const [state, githubClientSecret, githubWebhookSecret, zeropsAccessToken, privateKey] =
    await Promise.all([
      loadOrCreateState(),
      keychainSecret("ai.trialrun.github.client-secret"),
      keychainSecret("ai.trialrun.github.webhook-secret"),
      keychainSecret("ai.trialrun.zerops.integration"),
      readFile(new URL("github-app-private-key.pem", secretsDirectory)),
    ]);
  const clientId = await zeropsClientId(zeropsAccessToken);
  const document = importSchema.parse(
    parse(await readFile(new URL("zerops-project-import.yaml", workspace), "utf8")),
  );
  const web = requireService(document, "web");
  const runner = requireService(document, "runner");

  web.envSecrets = {
    ...web.envSecrets,
    CSRF_SECRET_BASE64: state.csrfSecretBase64,
    GITHUB_CLIENT_SECRET: githubClientSecret,
    GITHUB_PRIVATE_KEY_BASE64: privateKey.toString("base64"),
    GITHUB_WEBHOOK_SECRET: githubWebhookSecret,
    VAULT_KEY_BASE64: state.vaultKeyBase64,
  };
  runner.envSecrets = {
    ...runner.envSecrets,
    GITHUB_PRIVATE_KEY_BASE64: privateKey.toString("base64"),
    MANAGED_CODEX_HOME: "/home/zerops/.codex",
    SEED_USER_EMAIL: state.judgeEmail,
    SEED_USER_PASSWORD_HASH: state.judgePasswordHash,
    VAULT_KEY_BASE64: state.vaultKeyBase64,
    TRIALRUN_ZEROPS_ACCESS_TOKEN: zeropsAccessToken,
    TRIALRUN_ZEROPS_CLIENT_ID: clientId,
  };

  await mkdir(liveDirectory, { recursive: true, mode: 0o700 });
  await writeFile(outputUrl, stringify(document, { lineWidth: 0 }), {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(outputUrl, 0o600);
  process.stdout.write(
    "Rendered ignored live Zerops import with web, runner, database, object storage, and judge seed configuration.\n",
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown live import rendering error.";
  process.stderr.write(`Unable to render the live Zerops import: ${message}\n`);
  process.exitCode = 1;
});
