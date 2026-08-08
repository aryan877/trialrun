import { describe, expect, it } from "vitest";

import { analystRuntimeForTest } from "./analyst";

describe("bounded infrastructure analyst runtime", () => {
  it("passes only the explicit runtime allowlist and disables every ambient tool surface", () => {
    const environment = analystRuntimeForTest.safeAnalystEnvironment({
      apiKey: "managed-test-key-value",
      codexHome: "/isolated/codex",
      executionHome: "/isolated/home",
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
});
