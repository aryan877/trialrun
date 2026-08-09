import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  analystRuntimeForTest,
  codexInfrastructureProposalSchema,
  parseCodexInfrastructureProposal,
} from "./analyst.js";

const citation = {
  path: "package.json",
  lineStart: 1,
  lineEnd: 12,
  summary: "The application build and start scripts are declared here.",
  confidence: "high" as const,
};

function proposalWithNullableDependencyFields(): z.input<
  typeof codexInfrastructureProposalSchema
> {
  return {
    schemaVersion: 1,
    sourceSha: "a".repeat(40),
    summary: "One Node.js web service with object storage.",
    applications: [
      {
        name: "web",
        zeropsType: "alpine/nodejs@24",
        sourceRoot: ".",
        setup: "web",
        port: 3000,
        healthPath: "/health",
        build: {
          base: "alpine/nodejs@24",
          buildCommands: ["npm ci", "npm run build"],
          deployFiles: ["dist"],
        },
        run: { start: "node dist/server.js" },
        testTarget: true,
        publicAccess: false,
        resources: {
          minCpu: 1,
          maxCpu: 1,
          minRamGb: 0.5,
          maxRamGb: 1,
          minDiskGb: 1,
          maxDiskGb: 2,
        },
        evidence: [citation],
      },
    ],
    dependencies: [
      {
        name: "evidence",
        zeropsType: "object-storage",
        purpose: "Stores disposable test evidence.",
        resources: null,
        storageSizeGb: 1,
        evidence: [citation],
      },
    ],
    environmentBindings: [],
    secretBindings: [],
    unresolvedQuestions: [],
  };
}

describe("Codex infrastructure proposal transport", () => {
  it("requires nullable dependency fields for OpenAI strict structured output", () => {
    const dependencyBranchSchema = z
      .object({
        required: z.array(z.string()),
        properties: z
          .object({
            resources: z.object({ type: z.string() }).passthrough(),
            storageSizeGb: z.object({ type: z.string() }).passthrough(),
          })
          .passthrough(),
      })
      .passthrough();
    const generatedSchema = z
      .object({
        properties: z
          .object({
            dependencies: z
              .object({
                items: z
                  .object({
                    anyOf: z.array(dependencyBranchSchema).length(2),
                  })
                  .passthrough(),
              })
              .passthrough(),
          })
          .passthrough(),
      })
      .passthrough()
      .parse(z.toJSONSchema(codexInfrastructureProposalSchema, { target: "draft-7" }));
    const dependencyBranches = generatedSchema.properties.dependencies.items.anyOf;
    const objectStorageBranch = dependencyBranches.find(
      (branch) => branch.properties.resources.type === "null",
    );
    const managedServiceBranch = dependencyBranches.find(
      (branch) => branch.properties.resources.type === "object",
    );
    if (!objectStorageBranch || !managedServiceBranch) {
      throw new Error("Expected object-storage and managed-service dependency branches.");
    }

    for (const branch of dependencyBranches) {
      expect(branch.required).toEqual([
        "name",
        "zeropsType",
        "purpose",
        "resources",
        "storageSizeGb",
        "evidence",
      ]);
    }
    expect(objectStorageBranch.properties.storageSizeGb.type).toBe("integer");
    expect(managedServiceBranch.properties.storageSizeGb.type).toBe("null");
    expect(JSON.stringify(generatedSchema)).not.toContain("(?");
  });

  it("normalizes explicit nulls before strict domain validation", () => {
    const proposal = parseCodexInfrastructureProposal(proposalWithNullableDependencyFields());

    expect(proposal.dependencies).toEqual([
      {
        name: "evidence",
        zeropsType: "object-storage",
        purpose: "Stores disposable test evidence.",
        storageSizeGb: 1,
        evidence: [citation],
      },
    ]);
  });

  it("still applies the stronger domain health-path rule after transport parsing", () => {
    const candidate = proposalWithNullableDependencyFields();
    const [application] = candidate.applications;
    if (!application) throw new Error("Test proposal needs one application.");
    application.healthPath = "//not-a-valid-health-path";

    expect(() => parseCodexInfrastructureProposal(candidate)).toThrow();
  });
});

describe("bounded infrastructure analyst runtime", () => {
  it("passes only the explicit runtime allowlist and disables ambient tools", () => {
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

  it("enables only the authenticated repository read tools", () => {
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
