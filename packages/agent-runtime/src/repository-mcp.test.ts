import { describe, expect, it } from "vitest";

import { CodexCliInfrastructureAnalyst } from "./analyst.js";
import { CodexLiveAgent } from "./live-agent.js";
import { RepositoryMcpConnectionPolicy } from "./repository-mcp.js";

const bearerToken = "repository-token-with-at-least-thirty-two-bytes";

describe("repository MCP connection policy", () => {
  it("defaults to an exact loopback HTTP MCP route", () => {
    const policy = new RepositoryMcpConnectionPolicy();
    expect(policy.parse({ mcpUrl: "http://127.0.0.1:49152/mcp", bearerToken })).toEqual({
      mcpUrl: "http://127.0.0.1:49152/mcp",
      bearerToken,
    });
    for (const mcpUrl of [
      "http://localhost:49152/mcp",
      "http://127.1:49152/mcp",
      "https://127.0.0.1:49152/mcp",
      "http://127.0.0.1:49152/other",
      "http://127.0.0.1:49152/mcp?target=other",
      "https://trialrun.example/api/agent-tools/repository/mcp",
    ]) {
      expect(() => policy.parse({ mcpUrl, bearerToken })).toThrow(/exact loopback/);
    }
  });

  it("accepts only the configured exact HTTPS repository route for a remote workspace", () => {
    const configured = "https://trialrun.example/api/agent-tools/repository/mcp";
    const policy = new RepositoryMcpConnectionPolicy(configured);
    expect(policy.parse({ mcpUrl: configured, bearerToken })).toEqual({
      mcpUrl: configured,
      bearerToken,
    });
    for (const mcpUrl of [
      "https://other.example/api/agent-tools/repository/mcp",
      "https://trialrun.example/api/agent-tools/repository/mcp?target=other",
      "http://127.0.0.1:49152/mcp",
    ]) {
      expect(() => policy.parse({ mcpUrl, bearerToken })).toThrow(/configured remote/);
    }
  });

  it("rejects unsafe configured remote URLs before a Codex process can start", () => {
    for (const configured of [
      "",
      "http://trialrun.example/api/agent-tools/repository/mcp",
      "https://trialrun.example/other",
      "https://user:password@trialrun.example/api/agent-tools/repository/mcp",
      "https://trialrun.example/api/agent-tools/repository/mcp#fragment",
    ]) {
      expect(() => new RepositoryMcpConnectionPolicy(configured)).toThrow(/exact HTTPS/);
      expect(() => new CodexCliInfrastructureAnalyst({ repositoryMcpUrl: configured })).toThrow(
        /exact HTTPS/,
      );
      expect(() => new CodexLiveAgent({ repositoryMcpUrl: configured })).toThrow(/exact HTTPS/);
    }
  });

  it("requires a bounded bearer token", () => {
    const policy = new RepositoryMcpConnectionPolicy();
    expect(() =>
      policy.parse({ mcpUrl: "http://127.0.0.1:49152/mcp", bearerToken: "short" }),
    ).toThrow();
  });
});
