import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import {
  testAssertionSchema,
  testInputValueSchema,
  testLocatorSchema,
  testNavigationWaitUntilSchema,
  testPressKeySchema,
  testSelectOptionSchema,
} from "@trialrun/domain";
import { z } from "zod";

import { LiveBrowserError, type LiveBrowserSession } from "./live-browser";

const sideSchema = z.enum(["base", "head"]);
const observationIdSchema = z.string().min(1).max(160);
const cursorSchema = z.string().min(1).max(160);
const checkpointNameSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(80);
const artifactIdSchema = z.string().regex(/^artifact:[0-9a-f]{64}$/);

const maximumRequestBytes = 128 * 1_024;

export interface LiveBrowserServerOptions {
  readonly session: LiveBrowserSession;
  readonly executionToken: string;
  readonly reviewId: string;
  readonly host?: string;
  readonly port?: number;
}

export interface LiveBrowserServer {
  readonly host: string;
  readonly port: number;
  readonly mcpUrl: string;
  close(): Promise<void>;
}

interface FailureWindow {
  count: number;
  resetAt: number;
}

// MCP SDK 1.30's concrete Node transport exposes callback properties as
// `T | undefined`, while its public Transport interface models them as exact
// optional properties. This tiny delegation layer keeps strict optional typing
// enabled in TrialRun without an unchecked cast or a package-wide compiler escape.
class ExactOptionalStreamableTransport implements Transport {
  readonly #delegate = new StreamableHTTPServerTransport({ enableJsonResponse: true });

  onclose?: NonNullable<Transport["onclose"]>;
  onerror?: NonNullable<Transport["onerror"]>;
  onmessage?: NonNullable<Transport["onmessage"]>;

  async start(): Promise<void> {
    if (this.onclose) this.#delegate.onclose = this.onclose;
    if (this.onerror) this.#delegate.onerror = this.onerror;
    if (this.onmessage) this.#delegate.onmessage = this.onmessage;
    await this.#delegate.start();
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    await this.#delegate.send(message, options);
  }

  async close(): Promise<void> {
    await this.#delegate.close();
  }

  async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
    parsedBody: unknown,
  ): Promise<void> {
    await this.#delegate.handleRequest(request, response, parsedBody);
  }
}

function json(
  response: ServerResponse,
  status: number,
  body: Readonly<Record<string, unknown>>,
): void {
  const encoded = JSON.stringify(body);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(encoded),
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(encoded);
}

function tokenDigest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function bearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length);
  return token.length > 0 && token.length <= 1_024 ? token : null;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  if (request.headers["content-encoding"] !== undefined) {
    throw new Error("Encoded request bodies are not accepted.");
  }
  const declaredLength = request.headers["content-length"];
  if (declaredLength !== undefined) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > maximumRequestBytes) {
      throw new Error("Request body is too large.");
    }
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of request) {
    if (!Buffer.isBuffer(chunk)) throw new Error("Request body contains an invalid chunk.");
    const bytes: Uint8Array = Uint8Array.from(chunk);
    total += bytes.byteLength;
    if (total > maximumRequestBytes) throw new Error("Request body is too large.");
    chunks.push(bytes);
  }
  if (total === 0) return undefined;
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  return parsed;
}

function toolResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent:
      value !== null && typeof value === "object"
        ? (value as Record<string, unknown>)
        : { value },
  };
}

function toolFailure(error: unknown) {
  const code = error instanceof LiveBrowserError ? error.code : "INTERNAL_ERROR";
  const message =
    error instanceof LiveBrowserError
      ? error.message
      : "The live browser tool failed without producing trustworthy evidence.";
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({ error: { code, message } }) }],
  };
}

async function callTool<T>(operation: () => Promise<T>) {
  try {
    return toolResult(await operation());
  } catch (error) {
    return toolFailure(error);
  }
}

function createReviewMcpServer(session: LiveBrowserSession, reviewId: string): McpServer {
  const server = new McpServer(
    { name: "trialrun-live-review", version: "0.1.0" },
    {
      instructions: [
        `You are controlling the two live applications for TrialRun review ${reviewId}.`,
        "Always observe before acting, use the returned observationId, and use semantic locators.",
        "Every click/fill/select/press is rejected unless its locator resolves to exactly one element.",
        "Use the same checkpoint name on base and head only when they represent the same product state.",
        "For a verdict, record at least two same-name, same-path assertion pairs: one URL assertion and one product-behavior assertion with the identical semantic locator on both sides.",
        "Do not claim a verdict. Finish only after recording the strongest available matched evidence.",
      ].join(" "),
    },
  );

  server.registerTool(
    "review_status",
    {
      description: "Read the live review session state and remaining action/time budget.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => toolResult(session.status()),
  );

  server.registerTool(
    "browser_observe",
    {
      description:
        "Observe one current application through a bounded accessibility/DOM snapshot. Returns the observationId required by later locator actions.",
      inputSchema: { side: sideSchema },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ side }, extra) => callTool(() => session.observe({ side, signal: extra.signal })),
  );

  server.registerTool(
    "browser_navigate",
    {
      description:
        "Navigate one side to a relative same-origin path. Caller-supplied origins and external URLs are forbidden.",
      inputSchema: {
        side: sideSchema,
        path: z.string().regex(/^\/(?!\/).*/).max(2_000),
        waitUntil: testNavigationWaitUntilSchema.optional(),
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    async ({ side, path, waitUntil }, extra) =>
      callTool(() =>
        session.navigate({
          side,
          path,
          ...(waitUntil ? { waitUntil } : {}),
          signal: extra.signal,
        }),
      ),
  );

  server.registerTool(
    "browser_count",
    {
      description:
        "Count matches for a semantic locator against the exact observed state before attempting an action.",
      inputSchema: {
        side: sideSchema,
        observationId: observationIdSchema,
        locator: testLocatorSchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ side, observationId, locator }, extra) =>
      callTool(() => session.count({ side, observationId, locator, signal: extra.signal })),
  );

  server.registerTool(
    "browser_click",
    {
      description:
        "Click exactly one semantic target from the cited current observation. Stale or ambiguous observations are rejected.",
      inputSchema: {
        side: sideSchema,
        observationId: observationIdSchema,
        locator: testLocatorSchema,
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    async ({ side, observationId, locator }, extra) =>
      callTool(() => session.click({ side, observationId, locator, signal: extra.signal })),
  );

  server.registerTool(
    "browser_fill",
    {
      description:
        "Fill exactly one semantic target with a bounded literal or an approved named secret. Secret values are resolved inside the executor and never returned.",
      inputSchema: {
        side: sideSchema,
        observationId: observationIdSchema,
        locator: testLocatorSchema,
        value: testInputValueSchema,
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    async ({ side, observationId, locator, value }, extra) =>
      callTool(() =>
        session.fill({ side, observationId, locator, value, signal: extra.signal }),
      ),
  );

  server.registerTool(
    "browser_select",
    {
      description:
        "Select a native option by value, label, or index on exactly one semantic target.",
      inputSchema: {
        side: sideSchema,
        observationId: observationIdSchema,
        locator: testLocatorSchema,
        option: testSelectOptionSchema,
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    async ({ side, observationId, locator, option }, extra) =>
      callTool(() =>
        session.select({ side, observationId, locator, option, signal: extra.signal }),
      ),
  );

  server.registerTool(
    "browser_press",
    {
      description: "Press one allowlisted key on exactly one semantic target.",
      inputSchema: {
        side: sideSchema,
        observationId: observationIdSchema,
        locator: testLocatorSchema,
        key: testPressKeySchema,
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    async ({ side, observationId, locator, key }, extra) =>
      callTool(() => session.press({ side, observationId, locator, key, signal: extra.signal })),
  );

  server.registerTool(
    "browser_assert",
    {
      description:
        "Record a deterministic visibility, text, or URL assertion. The external oracle—not the agent—uses assertion evidence for the final verdict.",
      inputSchema: {
        side: sideSchema,
        name: checkpointNameSchema.describe(
          "Stable comparison name; use the same name on base and head only for the same assertion.",
        ),
        assertion: testAssertionSchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ side, name, assertion }, extra) =>
      callTool(() => session.assert({ side, name, assertion, signal: extra.signal })),
  );

  server.registerTool(
    "browser_checkpoint",
    {
      description:
        "Record a named product-state checkpoint and capture a screenshot when the side has not handled a named secret.",
      inputSchema: { side: sideSchema, name: checkpointNameSchema },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ side, name }, extra) =>
      callTool(() => session.checkpoint({ side, name, signal: extra.signal })),
  );

  server.registerTool(
    "browser_events",
    {
      description:
        "Read bounded console, page-error, HTTP-error, and failed-request evidence for one side using an opaque cursor.",
      inputSchema: { side: sideSchema, cursor: cursorSchema.optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ side, cursor }, extra) =>
      callTool(() =>
        session.events({ side, ...(cursor ? { cursor } : {}), signal: extra.signal }),
      ),
  );

  server.registerTool(
    "browser_reset",
    {
      description:
        "Destroy and recreate one side's isolated browser context to reproduce a journey from a clean browser state.",
      inputSchema: { side: sideSchema },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    async ({ side }, extra) => callTool(() => session.reset({ side, signal: extra.signal })),
  );

  server.registerTool(
    "finish_review",
    {
      description:
        "Seal the browser evidence ledger after the investigation. This does not choose pass/fail/inconclusive.",
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    async () =>
      callTool(async () => {
        const evidence = await session.seal("finished");
        return {
          status: evidence.status,
          evidenceEntries: evidence.ledger.length,
          assertions: evidence.assertions.length,
          matchedAssertionNames: evidence.matchedAssertionNames,
          checkpoints: evidence.checkpoints.length,
          matchedCheckpointNames: evidence.matchedCheckpointNames,
          browserEvents: evidence.events.length,
        };
      }),
  );

  return server;
}

async function closeHttpServer(server: Server): Promise<void> {
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
    server.closeIdleConnections();
  });
}

export async function startLiveBrowserServer(
  options: LiveBrowserServerOptions,
): Promise<LiveBrowserServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  if (options.executionToken.length < 32 || options.executionToken.length > 1_024) {
    throw new Error("The execution token must contain between 32 and 1024 characters.");
  }
  const expectedDigest = tokenDigest(options.executionToken);
  const failures = new Map<string, FailureWindow>();
  const failureWindowMs = 60_000;
  const maximumFailuresPerWindow = 20;

  const authenticated = (request: IncomingMessage, response: ServerResponse): boolean => {
    const address = request.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    const existing = failures.get(address);
    const window = !existing || existing.resetAt <= now ? { count: 0, resetAt: now + failureWindowMs } : existing;
    if (window.count >= maximumFailuresPerWindow) {
      response.setHeader("Retry-After", Math.max(1, Math.ceil((window.resetAt - now) / 1_000)));
      json(response, 429, { error: "Too many failed authentication attempts." });
      return false;
    }
    const supplied = bearerToken(request);
    const valid = supplied !== null && timingSafeEqual(tokenDigest(supplied), expectedDigest);
    if (valid) {
      failures.delete(address);
      return true;
    }
    window.count += 1;
    failures.set(address, window);
    response.setHeader("WWW-Authenticate", 'Bearer realm="trialrun-live-review"');
    json(response, 401, { error: "Unauthorized." });
    return false;
  };

  let closing = false;
  const handleRequest = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    try {
      const url = new URL(request.url ?? "/", "http://trialrun.invalid");
      if (url.search.length > 0) {
        json(response, 400, { error: "Query parameters are not accepted." });
        return;
      }
      if (request.method === "GET" && url.pathname === "/health") {
        json(response, closing ? 503 : 200, { status: closing ? "closing" : "ok" });
        return;
      }
      if (!authenticated(request, response)) return;
      if (request.headers.origin !== undefined) {
        json(response, 403, { error: "Browser-origin requests are not accepted." });
        return;
      }
      if (request.method === "GET" && url.pathname === "/evidence") {
        json(response, 200, { evidence: options.session.evidence() });
        return;
      }
      if (request.method === "POST" && url.pathname === "/cancel") {
        json(response, 200, { evidence: await options.session.cancel() });
        return;
      }
      if (request.method === "POST" && url.pathname === "/finish") {
        json(response, 200, { evidence: await options.session.seal("finished") });
        return;
      }
      if (request.method === "GET" && url.pathname.startsWith("/artifacts/")) {
        const artifactId = artifactIdSchema.parse(decodeURIComponent(url.pathname.slice(11)));
        const bytes = options.session.artifact(artifactId);
        const checkpoint = options.session
          .evidence()
          .checkpoints.find((candidate) => candidate.artifactId === artifactId);
        if (!checkpoint?.digest || checkpoint.byteSize !== bytes.byteLength) {
          throw new Error("Sealed artifact metadata does not match its bytes.");
        }
        response.writeHead(200, {
          "Cache-Control": "no-store",
          "Content-Disposition": `attachment; filename="${artifactId.replace(":", "-")}.png"`,
          "Content-Length": bytes.byteLength,
          "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
          "Content-Type": "image/png",
          Digest: `sha-256=${Buffer.from(checkpoint.digest, "hex").toString("base64")}`,
          "X-Content-Type-Options": "nosniff",
        });
        response.end(bytes);
        return;
      }
      if (request.method !== "POST" || url.pathname !== "/mcp") {
        json(response, 404, { error: "Not found." });
        return;
      }
      const body = await readJsonBody(request);
      const mcp = createReviewMcpServer(options.session, options.reviewId);
      const transport = new ExactOptionalStreamableTransport();
      response.once("close", () => {
        void transport.close();
        void mcp.close();
      });
      await mcp.connect(transport);
      await transport.handleRequest(request, response, body);
    } catch (error) {
      if (!response.headersSent) {
        json(response, 400, {
          error:
            error instanceof LiveBrowserError
              ? { code: error.code, message: error.message }
              : "Invalid request.",
        });
      } else {
        response.destroy();
      }
    }
  };
  const httpServer = createServer((request, response) => {
    void handleRequest(request, response);
  });
  httpServer.requestTimeout = 45_000;
  httpServer.headersTimeout = 10_000;
  httpServer.keepAliveTimeout = 5_000;
  httpServer.maxHeadersCount = 64;

  await new Promise<void>((resolveListen, rejectListen) => {
    httpServer.once("error", rejectListen);
    httpServer.listen(port, host, () => {
      httpServer.off("error", rejectListen);
      resolveListen();
    });
  });
  const address = httpServer.address();
  if (!address || typeof address === "string") {
    await closeHttpServer(httpServer);
    throw new Error("Live browser server did not bind to a TCP port.");
  }

  return {
    host,
    port: address.port,
    mcpUrl: `http://${host}:${address.port}/mcp`,
    close: async () => {
      if (closing) return;
      closing = true;
      if (options.session.status().state === "active") await options.session.cancel();
      await closeHttpServer(httpServer);
    },
  };
}
