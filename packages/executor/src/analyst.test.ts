import { describe, expect, it } from "vitest";

import { analystRuntimeForTest } from "./analyst";

describe("bounded infrastructure analyst runtime", () => {
  it("passes only the explicit runtime allowlist and disables every ambient tool surface", () => {
    const environment = analystRuntimeForTest.safeAnalystEnvironment({
      apiKey: "managed-test-key-value",
      codexHome: "/isolated/codex",
      executionHome: "/isolated/home",
      repositoryToken: "repository-token-that-never-leaks-to-host-tools",
      hostEnvironment: {
        PATH: "/usr/bin:/bin",
        LANG: "C.UTF-8",
        DATABASE_URL: "postgres://must-not-leak",
        GITHUB_CLIENT_SECRET: "must-not-leak",
        ZEROPS_ACCESS_TOKEN: "must-not-leak",
      },
    });

    expect(environment).toEqual({
      CODEX_HOME: "/isolated/codex",
      HOME: "/isolated/home",
      LANG: "C.UTF-8",
      NO_COLOR: "1",
      OPENAI_API_KEY: "managed-test-key-value",
      PATH: "/usr/bin:/bin",
      TERM: "dumb",
      TRIALRUN_ANALYST_REPOSITORY_MCP_TOKEN:
        "repository-token-that-never-leaks-to-host-tools",
    });
    expect(analystRuntimeForTest.disabledAnalystFeatures).toEqual(
      expect.arrayContaining([
        "apply_patch_freeform",
        "plugins",
        "shell_tool",
        "tool_search",
        "unified_exec",
        "web_search",
      ]),
    );
  });

  it("enables only the authenticated full-repository read tools", () => {
    const argumentsList = analystRuntimeForTest.analystSafetyArguments(
      "http://127.0.0.1:49152/mcp",
    );
    expect(argumentsList).toContain(
      'mcp_servers.trialrun_repository.bearer_token_env_var="TRIALRUN_ANALYST_REPOSITORY_MCP_TOKEN"',
    );
    expect(argumentsList).toContain(
      'mcp_servers.trialrun_repository.enabled_tools=["repository_tree","repository_search","repository_read"]',
    );
    expect(argumentsList).toContain("mcp_servers.trialrun_repository.required=true");
    expect(argumentsList).not.toContain("repository-token-that-never-leaks-to-host-tools");
    expect(analystRuntimeForTest.repositoryToolNames).toEqual([
      "repository_tree",
      "repository_search",
      "repository_read",
    ]);
  });
});
