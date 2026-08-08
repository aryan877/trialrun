import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { startRepositoryMcpServer, type RepositoryMcpServer } from "./repository-mcp.js";
import { createRepositoryView } from "./repository-view.js";

const token = "repository-test-token-that-is-long-enough-123456";
const cleanups: Array<() => Promise<void>> = [];

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

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function fixture(): Promise<RepositoryMcpServer> {
  const root = await mkdtemp(join(tmpdir(), "trialrun-repository-mcp-"));
  const baseDirectory = join(root, "base");
  const headDirectory = join(root, "head");
  await import("node:fs/promises").then(({ mkdir }) =>
    Promise.all([mkdir(baseDirectory), mkdir(headDirectory)]),
  );
  await Promise.all([
    writeFile(join(baseDirectory, "app.ts"), "export const total = 10;\n", "utf8"),
    writeFile(join(headDirectory, "app.ts"), "export const total = 11;\n", "utf8"),
  ]);
  const view = await createRepositoryView({ baseDirectory, headDirectory });
  const server = await startRepositoryMcpServer({
    view,
    executionToken: token,
    readApplicationLogs: (side) => Promise.resolve(`${side} server ready`),
  });
  cleanups.push(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
  });
  return server;
}

describe("repository MCP server", () => {
  it("rejects requests without its review-scoped bearer token", async () => {
    const server = await fixture();
    const response = await fetch(server.mcpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(response.status).toBe(401);
  });

  it("serves only the five bounded repository tools over authenticated MCP", async () => {
    const server = await fixture();
    const client = new Client({ name: "trialrun-test", version: "0.1.0" });
    const transport = new ExactOptionalClientTransport(new URL(server.mcpUrl), token);
    await client.connect(transport);
    cleanups.push(() => client.close());

    const listed = await client.listTools();
    expect(listed.tools.map(({ name }) => name).sort()).toEqual([
      "application_logs",
      "repository_changes",
      "repository_diff",
      "repository_read",
      "repository_search",
      "repository_tree",
    ]);

    const result = toolResultSchema.parse(
      await client.callTool({ name: "repository_changes", arguments: {} }),
    );
    expect(result.isError).not.toBe(true);
    const first = result.content[0];
    if (!first) throw new Error("Expected a text MCP result.");
    const payload: unknown = JSON.parse(first.text);
    expect(payload).toEqual([
      expect.objectContaining({ path: "app.ts", status: "modified" }),
    ]);
  });
});
