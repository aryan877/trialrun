import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";

import { policyApprovedRecipeSchema, randomToken, redactText } from "@trialrun/domain";

import { loadLocalSetup } from "./zerops-manifest";
import { LiveBrowserSession } from "./live-browser";
import { startLiveBrowserServer } from "./live-server";
import type {
  ExecutionEnvironment,
  ExecutionProvider,
  ProvisionInput,
  ReviewSide,
  TeardownProof,
} from "./types";

interface ManagedContainer {
  readonly id: string;
  readonly port: number;
}

const localImages: Readonly<Record<string, string>> = {
  "alpine/nodejs@24": "node:24-alpine",
  "alpine/nodejs@22": "node:22-alpine",
  "alpine/nodejs@20": "node:20-alpine",
  "alpine/bun@1.3.9": "oven/bun:1.3.9-alpine",
  "alpine/bun@1.2.2": "oven/bun:1.2.2-alpine",
  "ubuntu/deno@2.0.0": "denoland/deno:alpine-2.0.0",
  "alpine/python@3.12": "python:3.12-alpine",
  "alpine/python@3.11": "python:3.11-alpine",
  "alpine/go@1.22": "golang:1.22-alpine",
};

async function reservePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        rejectPort(new Error("Could not allocate a local review port."));
        return;
      }
      server.close((error) => (error ? rejectPort(error) : resolvePort(address.port)));
    });
  });
}

async function runDocker(
  args: readonly string[],
  options: { readonly environment?: NodeJS.ProcessEnv; readonly allowFailure?: boolean } = {},
): Promise<string> {
  return new Promise((resolveOutput, rejectOutput) => {
    const child = spawn("docker", [...args], {
      env: options.environment ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = `${stdout}${chunk.toString("utf8")}`.slice(-100_000);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-100_000);
    });
    child.once("error", rejectOutput);
    child.once("exit", (code, signal) => {
      if (code === 0 || options.allowFailure) resolveOutput(`${stdout}${stderr}`.trim());
      else rejectOutput(new Error(`docker ${args[0] ?? "command"} exited with ${code ?? signal}: ${stderr}`));
    });
  });
}

async function waitForReady(url: string, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "not ready";
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    try {
      const response = await fetch(url, {
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(1_000)])
          : AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
  }
  throw new Error(`Local container failed readiness at ${url}: ${lastError}`);
}

async function removeContainer(id: string): Promise<void> {
  await runDocker(["rm", "--force", id], { allowFailure: true });
}

async function containerIsAbsent(id: string): Promise<boolean> {
  const output = await runDocker(["inspect", "--format", "{{.Id}}", id], { allowFailure: true });
  return output.trim() !== id;
}

export class LocalExecutionProvider implements ExecutionProvider {
  async provision(input: ProvisionInput): Promise<ExecutionEnvironment> {
    const recipe = policyApprovedRecipeSchema.parse(input.recipe);
    if (recipe.applications.length !== 1 || recipe.dependencies.length > 0 || recipe.environmentBindings.length > 0) {
      throw new Error("Local Docker preview currently supports one application without managed dependencies; use Zerops for the confirmed full graph.");
    }
    const application = recipe.applications[0];
    if (!application) throw new Error("Recipe does not contain an application.");
    const image = localImages[application.zeropsType];
    if (!image) throw new Error(`Local Docker preview does not support ${application.zeropsType}; use Zerops.`);
    const providerProjectId = `local-${input.reviewId}`;
    await input.onProjectCreated?.(providerProjectId);
    const redactionValues = Object.values(input.secrets);
    const containers = {} as Record<ReviewSide, ManagedContainer>;

    const start = async (side: ReviewSide): Promise<ManagedContainer> => {
      const workspace = input.sourceWorkspaces[side];
      const setup = await loadLocalSetup(workspace.directory, application.sourceRoot, application.setup);
      const hostPort = await reservePort();
      const name = `trialrun-${input.reviewId.slice(0, 8)}-${side}`;
      const secretEnvironment = Object.fromEntries(
        recipe.secretBindings
          .filter(({ targetService }) => targetService === application.name)
          .map(({ environmentName, secretName }) => {
            const value = input.secrets[secretName];
            if (!value) throw new Error(`Required repository secret ${secretName} is missing.`);
            return [environmentName, value];
          }),
      );
      const command = ["set -eu", ...setup.buildCommands, `exec ${setup.startCommand}`].join("\n");
      const environment = {
        ...process.env,
        ...setup.environment,
        ...secretEnvironment,
        HOST: "0.0.0.0",
        NODE_ENV: "test",
        PORT: String(application.port),
      };
      const inheritedNames = Object.keys({ ...setup.environment, ...secretEnvironment, HOST: "", NODE_ENV: "", PORT: "" });
      const id = await runDocker(
        [
          "run",
          "--detach",
          "--rm",
          "--init",
          "--name",
          name,
          "--publish",
          `127.0.0.1:${hostPort}:${application.port}`,
          "--volume",
          `${workspace.directory}:/workspace`,
          "--workdir",
          application.sourceRoot === "." ? "/workspace" : join("/workspace", application.sourceRoot),
          ...inheritedNames.flatMap((environmentName) => ["--env", environmentName]),
          image,
          "sh",
          "-lc",
          command,
        ],
        { environment },
      );
      const normalizedId = id.trim();
      try {
        await waitForReady(
          new URL(application.healthPath, `http://127.0.0.1:${hostPort}`).href,
          60_000,
          input.signal,
        );
      } catch (error) {
        const logs = await runDocker(["logs", normalizedId], { allowFailure: true });
        await removeContainer(normalizedId);
        throw new Error(`${error instanceof Error ? error.message : String(error)}\n${redactText(logs, redactionValues)}`);
      }
      return { id: normalizedId, port: hostPort };
    };

    try {
      containers.base = await start("base");
      containers.head = await start("head");
    } catch (error) {
      if (containers.base) await removeContainer(containers.base.id);
      if (containers.head) await removeContainer(containers.head.id);
      throw error;
    }

    let destroyed = false;
    const baseUrl = `http://127.0.0.1:${containers.base.port}`;
    const headUrl = `http://127.0.0.1:${containers.head.port}`;
    const executionToken = randomToken();
    let liveSession: LiveBrowserSession;
    let liveServer: Awaited<ReturnType<typeof startLiveBrowserServer>>;
    try {
      liveSession = await LiveBrowserSession.create({
        origins: { base: baseUrl, head: headUrl },
        secrets: input.secrets,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      liveServer = await startLiveBrowserServer({
        session: liveSession,
        executionToken,
        reviewId: input.reviewId,
      });
    } catch (error) {
      await Promise.all([removeContainer(containers.base.id), removeContainer(containers.head.id)]);
      throw error;
    }
    return {
      provider: "local",
      providerProjectId,
      baseUrl,
      headUrl,
      liveReview: { mcpUrl: liveServer.mcpUrl, bearerToken: executionToken },
      readLiveEvidence: () => Promise.resolve(liveSession.evidence()),
      readLiveArtifact: (artifactId) => Promise.resolve(liveSession.artifact(artifactId)),
      sealLiveReview: async () => liveSession.seal("finished"),
      cancelLiveReview: async () => liveSession.cancel(),
      readLogs: async (side) =>
        redactText(await runDocker(["logs", containers[side].id], { allowFailure: true }), redactionValues),
      destroy: async (): Promise<TeardownProof> => {
        const startedAt = new Date().toISOString();
        if (!destroyed) {
          await liveServer.close();
          await Promise.all([removeContainer(containers.base.id), removeContainer(containers.head.id)]);
          destroyed = true;
        }
        const [baseAbsent, headAbsent] = await Promise.all([
          containerIsAbsent(containers.base.id),
          containerIsAbsent(containers.head.id),
        ]);
        const deleted = baseAbsent && headAbsent;
        return {
          startedAt,
          completedAt: new Date().toISOString(),
          providerProjectId,
          deleted,
          message: deleted
            ? "Both exact local review containers are absent after teardown."
            : "At least one exact local review container still exists after teardown.",
        };
      },
    };
  }
}
