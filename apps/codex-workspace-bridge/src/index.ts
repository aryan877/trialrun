import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";

import { z } from "zod";

import { CodexConnectionProbe, workspaceProbeResultSchema } from "@trialrun/agent-runtime";

import { DeviceLoginManager } from "./device-login.js";
import { WorkspaceInvocationManager } from "./invocations.js";
import { logoutCodex } from "./logout.js";
import { RequestVerifier } from "./protocol.js";

const configSchema = z.strictObject({
  CODEX_BINARY: z.string().min(1).default("codex"),
  CODEX_HOME: z.string().min(1).default("/home/zerops/.codex"),
  HOME: z.string().min(1).default("/home/zerops"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  TRIALRUN_BRIDGE_AUDIENCE: z.string().regex(/^agent-connection:[0-9a-f-]{36}$/),
  TRIALRUN_BRIDGE_PUBLIC_KEY_BASE64: z.base64(),
  TRIALRUN_REPOSITORY_MCP_URL: z
    .url()
    .refine((value) => new URL(value).pathname === "/api/agent-tools/repository/mcp"),
});
const config = configSchema.parse({
  CODEX_BINARY: process.env.CODEX_BINARY,
  CODEX_HOME: process.env.CODEX_HOME,
  HOME: process.env.HOME,
  PORT: process.env.PORT,
  TRIALRUN_BRIDGE_AUDIENCE: process.env.TRIALRUN_BRIDGE_AUDIENCE,
  TRIALRUN_BRIDGE_PUBLIC_KEY_BASE64: process.env.TRIALRUN_BRIDGE_PUBLIC_KEY_BASE64,
  TRIALRUN_REPOSITORY_MCP_URL: process.env.TRIALRUN_REPOSITORY_MCP_URL,
});
const maximumBodyBytes = 256 * 1_024;
const verifier = new RequestVerifier(
  config.TRIALRUN_BRIDGE_PUBLIC_KEY_BASE64,
  config.TRIALRUN_BRIDGE_AUDIENCE,
);
const login = new DeviceLoginManager({
  codexBinary: config.CODEX_BINARY,
  codexHome: resolve(config.CODEX_HOME),
  executionHome: resolve(config.HOME),
});
const probe = new CodexConnectionProbe({
  binary: config.CODEX_BINARY,
  codexHome: resolve(config.CODEX_HOME),
  executionHome: resolve(config.HOME),
});
const invocations = new WorkspaceInvocationManager({
  codexBinary: config.CODEX_BINARY,
  codexHome: resolve(config.CODEX_HOME),
  repositoryMcpUrl: config.TRIALRUN_REPOSITORY_MCP_URL,
});

function json(response: ServerResponse, status: number, body: object): void {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

async function bodyBytes(request: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const rawChunk: unknown = chunk;
    if (!Buffer.isBuffer(rawChunk)) throw new Error("Request body contains invalid bytes.");
    const bytes = rawChunk;
    size += bytes.byteLength;
    if (size > maximumBodyBytes) throw new Error("Request body is too large.");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", "http://bridge.internal");
  if (request.method === "GET" && url.pathname === "/health") {
    json(response, 200, { status: "ready" });
    return;
  }
  let body: Uint8Array;
  try {
    if (url.search !== "") throw new Error("Bridge query parameters are forbidden.");
    if (request.headers.origin) throw new Error("Browser-originated bridge requests are forbidden.");
    if (request.headers["content-encoding"] !== undefined) {
      throw new Error("Encoded bridge request bodies are forbidden.");
    }
    body = await bodyBytes(request);
    verifier.verify({
      method: request.method ?? "GET",
      pathname: url.pathname,
      body,
      headers: {
        "x-trialrun-timestamp": request.headers["x-trialrun-timestamp"]?.toString(),
        "x-trialrun-nonce": request.headers["x-trialrun-nonce"]?.toString(),
        "x-trialrun-signature": request.headers["x-trialrun-signature"]?.toString(),
        "x-trialrun-audience": request.headers["x-trialrun-audience"]?.toString(),
      },
    });
  } catch {
    json(response, 401, { error: "unauthorized" });
    return;
  }

  try {
    if (request.method === "POST" && url.pathname === "/v1/login/start") {
      json(response, 200, await login.start());
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/login/status") {
      json(response, 200, login.state());
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/login/cancel") {
      login.cancel();
      json(response, 200, { status: "cancelled" });
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/logout") {
      login.cancel();
      invocations.cancelAll();
      await logoutCodex({
        codexBinary: config.CODEX_BINARY,
        codexHome: resolve(config.CODEX_HOME),
        executionHome: resolve(config.HOME),
      });
      json(response, 200, { status: "logged_out" });
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/probe") {
      json(response, 200, workspaceProbeResultSchema.parse(await probe.run()));
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/invocations") {
      json(response, 202, invocations.start(JSON.parse(Buffer.from(body).toString("utf8"))));
      return;
    }
    const invocationMatch = url.pathname.match(/^\/v1\/invocations\/([0-9a-f-]{36})$/);
    if (invocationMatch?.[1] && request.method === "GET") {
      const state = invocations.read(invocationMatch[1]);
      json(response, state ? 200 : 404, state ?? { error: "not_found" });
      return;
    }
    if (invocationMatch?.[1] && request.method === "DELETE") {
      const state = invocations.cancel(invocationMatch[1]);
      json(response, state ? 202 : 404, state ?? { error: "not_found" });
      return;
    }
    json(response, 404, { error: "not_found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workspace operation failed.";
    process.stderr.write(`TrialRun workspace operation failed: ${message}\n`);
    json(response, 503, { error: "workspace_operation_failed" });
  }
}

const server = createServer((request, response) => {
  void handleRequest(request, response);
});
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 64;

server.listen(config.PORT, "0.0.0.0", () => {
  process.stdout.write(`TrialRun Codex workspace bridge is listening on ${config.PORT}.\n`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    login.cancel();
    invocations.cancelAll();
    server.close(() => process.exit(0));
  });
}
