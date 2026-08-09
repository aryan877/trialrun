import { createServer, type Server } from "node:http";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { LiveBrowserSession } from "./live-browser";
import { startLiveBrowserServer } from "./live-server";

interface TestApplication {
  readonly origin: string;
  readonly close: () => Promise<void>;
}

const applications: TestApplication[] = [];
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  await Promise.all(applications.splice(0).map(({ close }) => close()));
});

class ExactOptionalClientTransport implements Transport {
  readonly #delegate: StreamableHTTPClientTransport;

  onclose?: NonNullable<Transport["onclose"]>;
  onerror?: NonNullable<Transport["onerror"]>;
  onmessage?: NonNullable<Transport["onmessage"]>;

  constructor(url: URL, executionToken: string) {
    this.#delegate = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: `Bearer ${executionToken}` } },
    });
  }

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
}

const toolResultSchema = z.object({
  isError: z.boolean().optional(),
  content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
});

function toolPayload(result: unknown): unknown {
  const parsed = toolResultSchema.parse(result);
  expect(parsed.isError).not.toBe(true);
  const first = parsed.content[0];
  if (!first) throw new Error("Expected a text MCP tool result.");
  return JSON.parse(first.text);
}

function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeIdleConnections();
  });
}

async function startApplication(side: "base" | "head"): Promise<TestApplication> {
  const cookie = `trialrun-${side}-session`;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://trialrun.invalid");
    if (request.method === "GET" && url.pathname === "/") {
      const body = `<main><h1>${side}</h1></main>`;
      response.writeHead(200, {
        "Content-Length": Buffer.byteLength(body),
        "Content-Type": "text/html; charset=utf-8",
        "Set-Cookie": `session=${cookie}; HttpOnly; Path=/; SameSite=Lax`,
      });
      response.end(body);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/session") {
      const authenticated = request.headers.cookie?.includes(`session=${cookie}`) === true;
      const body = JSON.stringify({ authenticated, side });
      response.writeHead(authenticated ? 200 : 401, {
        "Content-Length": Buffer.byteLength(body),
        "Content-Type": "application/json; charset=utf-8",
      });
      response.end(body);
      return;
    }
    response.writeHead(404, { "Content-Length": "0" });
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("Test application did not bind to a TCP port.");
  }
  const application = {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
  };
  applications.push(application);
  return application;
}

describe("live API through real Chromium state", () => {
  it("reuses each side's HttpOnly browser cookie without exposing it to Codex", async () => {
    const [base, head] = await Promise.all([startApplication("base"), startApplication("head")]);
    const session = await LiveBrowserSession.create({
      origins: { base: base.origin, head: head.origin },
    });
    try {
      const pair = await session.apiRequestPair({
        name: "authenticated-session",
        request: { method: "GET", path: "/api/session" },
      });
      expect(pair.base).toMatchObject({ status: 200, bodyTruncated: false });
      expect(pair.head).toMatchObject({ status: 200, bodyTruncated: false });
      expect(pair.base.bodyPreview).toContain('"authenticated":true');
      expect(pair.head.bodyPreview).toContain('"authenticated":true');
      expect(JSON.stringify(session.evidence())).not.toContain("trialrun-base-session");
      expect(JSON.stringify(session.evidence())).not.toContain("trialrun-head-session");

      await expect(
        session.apiAssert({
          side: "base",
          name: "authenticated-session-contract",
          responseId: pair.base.id,
          assertion: {
            kind: "json_path_equals",
            path: ["authenticated"],
            equals: true,
          },
        }),
      ).resolves.toMatchObject({ passed: true });
      await expect(
        session.apiAssert({
          side: "head",
          name: "authenticated-session-contract",
          responseId: pair.head.id,
          assertion: {
            kind: "json_path_equals",
            path: ["authenticated"],
            equals: true,
          },
        }),
      ).resolves.toMatchObject({ passed: true });
    } finally {
      await session.cancel();
    }
  });

  it("exposes only the bounded API contract through the authenticated live MCP server", async () => {
    const [base, head] = await Promise.all([startApplication("base"), startApplication("head")]);
    const session = await LiveBrowserSession.create({
      origins: { base: base.origin, head: head.origin },
    });
    const token = "live-api-integration-token-that-is-long-enough";
    const server = await startLiveBrowserServer({
      session,
      executionToken: token,
      reviewId: "live-api-integration-review",
    });
    cleanups.push(() => server.close());
    const client = new Client({ name: "trialrun-live-api-test", version: "0.1.0" });
    await client.connect(new ExactOptionalClientTransport(new URL(server.mcpUrl), token));
    cleanups.push(() => client.close());

    const listed = await client.listTools();
    expect(listed.tools.map(({ name }) => name)).toEqual(
      expect.arrayContaining(["api_request", "api_request_pair", "api_assert", "browser_assert"]),
    );
    expect(listed.tools.map(({ name }) => name)).not.toEqual(
      expect.arrayContaining(["fetch_url", "javascript", "shell"]),
    );

    const pair = z
      .object({
        base: z.object({ id: z.string(), status: z.literal(200) }),
        head: z.object({ id: z.string(), status: z.literal(200) }),
      })
      .parse(
        toolPayload(
          await client.callTool({
            name: "api_request_pair",
            arguments: {
              name: "authenticated-session",
              request: { method: "GET", path: "/api/session" },
            },
          }),
        ),
      );
    for (const side of ["base", "head"] as const) {
      expect(
        toolPayload(
          await client.callTool({
            name: "api_assert",
            arguments: {
              side,
              name: "authenticated-session-contract",
              responseId: pair[side].id,
              assertion: {
                kind: "json_path_equals",
                path: ["authenticated"],
                equals: true,
              },
            },
          }),
        ),
      ).toMatchObject({ side, passed: true, kind: "api_json" });
    }
  });
});
