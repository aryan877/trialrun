import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  applyInfrastructurePolicy,
  compareRuns,
  testPlanSchema,
  type PolicyApprovedRecipe,
  type TestPlan,
} from "@trialrun/domain";
import { afterEach, describe, expect, it } from "vitest";

import { BrowserExecutor } from "./browser-executor";
import { stageLocalGitReview, type StagedGitReview } from "./git-source";
import { LocalExecutionProvider } from "./local-provider";
import type { ExecutionEnvironment } from "./types";

const execFileAsync = promisify(execFile);
const scratchDirectories: string[] = [];
const environments: ExecutionEnvironment[] = [];
const stagedReviews: StagedGitReview[] = [];

async function scratch(prefix = "trialrun-browser-test-"): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  scratchDirectories.push(directory);
  return directory;
}

async function runGit(repositoryDirectory: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repositoryDirectory,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return stdout.trim();
}

function serverSource(regression: boolean): string {
  return `import { createServer } from "node:http";

const regression = ${String(regression)};
const port = Number(process.env.PORT ?? 3000);

createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
    return;
  }
  if (request.method === "POST" && request.url === "/api/orders") {
    response.writeHead(regression ? 500 : 201, { "content-type": "application/json" });
    response.end(JSON.stringify(regression ? { error: "checkout failed" } : { id: "order-1" }));
    return;
  }
  if (request.method === "GET" && request.url === "/") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(\`<!doctype html>
      <html lang="en">
        <head><meta charset="utf-8"><title>Exact commit checkout test</title></head>
        <body>
          <main>
            <h1>Checkout</h1>
            <button type="button">Place test order</button>
            <p data-testid="order-status">Ready</p>
          </main>
          <script>
            const button = document.querySelector("button");
            const status = document.querySelector("[data-testid=order-status]");
            button.addEventListener("click", async () => {
              const result = await fetch("/api/orders", { method: "POST" });
              status.textContent = result.ok ? "Order confirmed" : "Order failed";
            });
          </script>
        </body>
      </html>\`);
    return;
  }
  response.writeHead(404, { "content-type": "text/plain" });
  response.end("not found");
}).listen(port, "0.0.0.0");
`;
}

interface TestRepository {
  readonly directory: string;
  readonly baseSha: string;
  readonly headSha: string;
}

async function createTwoCommitRepository(): Promise<TestRepository> {
  const directory = await scratch("trialrun-source-repository-");
  await runGit(directory, "init", "--initial-branch=main");
  await runGit(directory, "config", "user.name", "TrialRun integration test");
  await runGit(directory, "config", "user.email", "integration@trialrun.invalid");
  await writeFile(join(directory, "package.json"), '{"private":true,"type":"module"}\n');
  await writeFile(
    join(directory, "zerops.yaml"),
    "zerops:\n  - setup: app\n    build:\n      base: nodejs@24\n    run:\n      start: node server.mjs\n",
  );
  await writeFile(join(directory, ".env.example"), "TEST_API_KEY=\n");
  await writeFile(join(directory, "server.mjs"), serverSource(false));
  await runGit(directory, "add", "package.json", "zerops.yaml", ".env.example", "server.mjs");
  await runGit(directory, "commit", "-m", "Add working checkout");
  const baseSha = await runGit(directory, "rev-parse", "HEAD");

  await writeFile(join(directory, "server.mjs"), serverSource(true));
  await runGit(directory, "add", "server.mjs");
  await runGit(directory, "commit", "-m", "Regress order creation");
  const headSha = await runGit(directory, "rev-parse", "HEAD");
  return { directory, baseSha, headSha };
}

function approvedRecipe(sourceSha: string, withSecret: boolean): PolicyApprovedRecipe {
  const evidence = [
    {
      path: "zerops.yaml",
      lineStart: 1,
      lineEnd: 6,
      summary: "Declares the Node runtime, setup, and start command.",
      confidence: "high" as const,
    },
  ];
  const decision = applyInfrastructurePolicy({
    schemaVersion: 1,
    sourceSha,
    summary: "One private Node application exercised through its checkout flow.",
    applications: [
      {
        name: "app",
        zeropsType: "alpine/nodejs@24",
        sourceRoot: ".",
        setup: "app",
        port: 3000,
        healthPath: "/health",
        build: {
          base: "alpine/nodejs@24",
          buildCommands: [],
          deployFiles: ["."],
        },
        run: { start: "node server.mjs" },
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
        evidence,
      },
    ],
    dependencies: [],
    environmentBindings: [],
    secretBindings: withSecret
      ? [
          {
            targetService: "app",
            environmentName: "TEST_API_KEY",
            secretName: "TEST_API_KEY",
            evidence: [
              {
                path: ".env.example",
                lineStart: 1,
                lineEnd: 1,
                summary: "Declares the test-only credential name without a value.",
                confidence: "high" as const,
              },
            ],
          },
        ]
      : [],
    unresolvedQuestions: [],
  });
  if (!decision.accepted) {
    throw new Error(`Integration recipe was rejected: ${JSON.stringify(decision.errors)}`);
  }
  return decision.recipe;
}

function checkoutPlan(): TestPlan {
  return testPlanSchema.parse({
    version: 1,
    title: "Create an order from checkout",
    rationale: "The changed commit must preserve the order API contract and visible confirmation.",
    requiredSecretNames: [],
    steps: [
      { action: "goto", path: "/", waitUntil: "domcontentloaded" },
      { action: "checkpoint", name: "checkout-ready" },
      {
        action: "click",
        target: { kind: "role", role: "button", name: "Place test order", exact: true },
        response: { path: "/api/orders", method: "POST", expectedStatus: 201 },
      },
      {
        action: "assert",
        assertion: {
          kind: "text",
          target: { kind: "test_id", value: "order-status" },
          includes: "Order confirmed",
        },
      },
      { action: "checkpoint", name: "order-confirmed" },
    ],
  });
}

async function environment(
  repository: TestRepository,
  secrets: Readonly<Record<string, string>> = {},
): Promise<ExecutionEnvironment> {
  const staged = await stageLocalGitReview({
    repositoryDirectory: repository.directory,
    baseSha: repository.baseSha,
    headSha: repository.headSha,
  });
  stagedReviews.push(staged);
  const provisioned = await new LocalExecutionProvider().provision({
    ownershipTokenHash: "a".repeat(64),
    reviewId: randomUUID(),
    recipe: approvedRecipe(repository.headSha, Object.keys(secrets).length > 0),
    sourceWorkspaces: staged.sourceWorkspaces,
    secrets,
  });
  environments.push(provisioned);
  return provisioned;
}

afterEach(async () => {
  await Promise.all(environments.splice(0).map((active) => active.destroy()));
  await Promise.all(stagedReviews.splice(0).map((staged) => staged.cleanup()));
  await Promise.all(
    scratchDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("real exact-commit browser review", () => {
  it("finds a regression introduced by the changed Git commit and preserves aligned evidence", async () => {
    const repository = await createTwoCommitRepository();
    const active = await environment(repository);
    const artifactRoot = await scratch();
    const [base, head] = await new BrowserExecutor().runPair({
      baseUrl: active.baseUrl,
      headUrl: active.headUrl,
      plan: checkoutPlan(),
      secrets: {},
      artifactRoot,
    });

    const comparison = compareRuns(base, head);
    expect(comparison.verdict).toBe("fail");
    expect(comparison.findings).toHaveLength(1);
    expect(comparison.findings[0]?.firstDivergentStep).toBe(2);
    expect(base.assertions).toHaveLength(5);
    expect(head.assertions).toHaveLength(3);
    expect(base.artifactPolicy).toBe("full");
    expect(base.tracePath).toBeTruthy();
    expect(base.videoPath).toBeTruthy();
    expect(base.observationsPath).toBeTruthy();
    expect(base.checkpoints.map(({ name }) => name)).toEqual(["checkout-ready", "order-confirmed"]);
    expect(head.checkpoints.map(({ name }) => name)).toEqual(["checkout-ready"]);

    const proof = await active.destroy();
    expect(proof.deleted).toBe(true);
    expect(proof.message).toContain("absent");
    environments.splice(environments.indexOf(active), 1);
  }, 120_000);

  it("persists no visual or DOM artifacts when an environment secret is present", async () => {
    const repository = await createTwoCommitRepository();
    const secret = "trialrun-test-secret-never-persist";
    const active = await environment(repository, { TEST_API_KEY: secret });
    const artifactRoot = await scratch();
    const [base, head] = await new BrowserExecutor().runPair({
      baseUrl: active.baseUrl,
      headUrl: active.headUrl,
      plan: checkoutPlan(),
      secrets: { TEST_API_KEY: secret },
      artifactRoot,
    });

    expect(base.artifactPolicy).toBe("secret_safe");
    expect(head.artifactPolicy).toBe("secret_safe");
    expect(base.checkpoints).toEqual([]);
    expect(head.checkpoints).toEqual([]);
    expect(base.tracePath).toBeUndefined();
    expect(base.videoPath).toBeUndefined();
    expect(base.observationsPath).toBeUndefined();
    expect(await readdir(artifactRoot, { recursive: true })).toEqual(
      expect.arrayContaining(["base", "head"]),
    );
    expect(
      (await readdir(artifactRoot, { recursive: true })).filter((name) =>
        /\.(json|png|webm|zip)$/i.test(name),
      ),
    ).toEqual([]);
  }, 120_000);
});
