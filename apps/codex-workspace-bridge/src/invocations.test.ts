import { describe, expect, it } from "vitest";

import { workspaceInvocationInternals } from "./invocations";

describe("workspace invocation network boundary", () => {
  it("accepts only the exact disposable Zerops executor MCP route", () => {
    expect(() =>
      workspaceInvocationInternals.assertExactZeropsLiveMcpUrl(
        "https://executor-proof-3000.prg1.zerops.app/mcp",
      ),
    ).not.toThrow();
    for (const url of [
      "https://example.com/mcp",
      "http://executor-proof-3000.prg1.zerops.app/mcp",
      "https://executor-proof-3000.prg1.zerops.app/",
      "https://executor-proof-3000.prg1.zerops.app/mcp?redirect=1",
    ]) {
      expect(() => workspaceInvocationInternals.assertExactZeropsLiveMcpUrl(url)).toThrow(
        /exact disposable Zerops executor/,
      );
    }
  });
});
