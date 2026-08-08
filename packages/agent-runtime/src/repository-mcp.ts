import { z } from "zod";

export interface AgentMcpConnection {
  readonly mcpUrl: string;
  readonly bearerToken: string;
}

const connectionSchema = z.strictObject({
  mcpUrl: z.url(),
  bearerToken: z.string().min(32).max(1_024),
});

function isExactLoopbackRepositoryUrl(value: string): boolean {
  const url = new URL(value);
  return (
    url.href === value &&
    url.protocol === "http:" &&
    url.hostname === "127.0.0.1" &&
    url.pathname === "/mcp" &&
    url.search === "" &&
    url.hash === "" &&
    url.username === "" &&
    url.password === ""
  );
}

function parseConfiguredRemoteUrl(value: string): string {
  return z
    .string()
    .min(1)
    .max(2_048)
    .refine((candidate) => {
      try {
        const url = new URL(candidate);
        return (
          url.href === candidate &&
          url.protocol === "https:" &&
          url.pathname === "/api/agent-tools/repository/mcp" &&
          url.search === "" &&
          url.hash === "" &&
          url.username === "" &&
          url.password === ""
        );
      } catch {
        return false;
      }
    }, "The configured repository MCP URL must be an exact HTTPS agent-tools route.")
    .parse(value);
}

export class RepositoryMcpConnectionPolicy {
  readonly #configuredRemoteUrl: string | undefined;

  constructor(configuredRemoteUrl?: string) {
    this.#configuredRemoteUrl =
      configuredRemoteUrl === undefined ? undefined : parseConfiguredRemoteUrl(configuredRemoteUrl);
  }

  parse(input: unknown): AgentMcpConnection {
    const connection = connectionSchema.parse(input);
    const accepted = this.#configuredRemoteUrl
      ? connection.mcpUrl === this.#configuredRemoteUrl
      : isExactLoopbackRepositoryUrl(connection.mcpUrl);
    if (!accepted) {
      throw new Error(
        this.#configuredRemoteUrl
          ? "Repository MCP URL does not match the configured remote workspace route."
          : "Repository MCP URL must be an exact loopback HTTP /mcp URL.",
      );
    }
    return connection;
  }
}

export const repositoryMcpRuntimeForTest = {
  isExactLoopbackRepositoryUrl,
  parseConfiguredRemoteUrl,
};
