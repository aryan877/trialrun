import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { CompiledDeploymentTarget } from "@trialrun/domain";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import {
  assertZeropsDeploymentContract,
  loadZeropsManifest,
  prepareZeropsManifest,
} from "./zerops-manifest";

const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "trialrun-manifest-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

const deployment: CompiledDeploymentTarget = {
  side: "head",
  logicalService: "web",
  hostname: "headweb",
  sourceRoot: ".",
  setup: "web",
  sha: "b".repeat(40),
  port: 3_000,
  healthPath: "/api/health",
  build: {
    base: "alpine/nodejs@24",
    buildCommands: ["npm ci", "npm run build"],
    deployFiles: ["dist", "package.json"],
  },
  run: { base: "alpine/nodejs@24", start: "node dist/server.js" },
  environmentBindings: [
    {
      environmentName: "DATABASE_URL",
      sourceService: "db",
      sourceHostname: "headdb",
      sourceProperty: "connectionString",
    },
  ],
  secretBindings: [{ environmentName: "TEST_API_KEY", secretName: "TEST_API_KEY" }],
};

const generatedManifestSchema = z.strictObject({
  zerops: z.tuple([
    z.strictObject({
      setup: z.literal("web"),
      build: z.strictObject({
        base: z.string(),
        buildCommands: z.array(z.string()).optional(),
        deployFiles: z.array(z.string()),
      }),
      deploy: z.strictObject({
        readinessCheck: z.strictObject({
          httpGet: z.strictObject({ port: z.number(), path: z.string() }),
        }),
      }),
      run: z.strictObject({
        base: z.string(),
        ports: z.array(
          z.strictObject({
            port: z.number(),
            httpSupport: z.literal(true),
          }),
        ),
        envVariables: z.record(z.string(), z.string()).optional(),
        start: z.string(),
      }),
    }),
  ]),
});

function parseGeneratedManifest(yaml: string): z.infer<typeof generatedManifestSchema> {
  const document: unknown = parseYaml(yaml);
  return generatedManifestSchema.parse(document);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("prepareZeropsManifest", () => {
  it("generates one complete setup from the approved plan and isolated bindings", async () => {
    const workspace = await temporaryDirectory();
    await writeFile(join(workspace, "zerops.yaml"), "customer: manifest-is-not-read\n", "utf8");

    const prepared = await prepareZeropsManifest(workspace, deployment);
    const setup = parseGeneratedManifest(prepared.yaml).zerops[0];
    expect(setup).toEqual({
      setup: "web",
      build: {
        base: "alpine/nodejs@24",
        buildCommands: ["npm ci", "npm run build"],
        deployFiles: ["dist", "package.json"],
      },
      deploy: {
        readinessCheck: {
          httpGet: { port: 3_000, path: "/api/health" },
        },
      },
      run: {
        base: "alpine/nodejs@24",
        ports: [{ port: 3_000, httpSupport: true }],
        envVariables: { DATABASE_URL: "${headdb_connectionString}" },
        start: "node dist/server.js",
      },
    });
    expect(prepared.bindingDiff).toEqual([
      { environmentName: "DATABASE_URL", value: "${headdb_connectionString}" },
      { environmentName: "TEST_API_KEY", value: null },
    ]);
    expect(prepared.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await lstat(prepared.path)).mode & 0o777).toBe(0o600);
    await prepared.cleanup();
    await expect(readFile(prepared.path)).rejects.toMatchObject({ code: "ENOENT" });
    await prepared.cleanup();
  });

  it("does not require a customer workspace or manifest", async () => {
    const parent = await temporaryDirectory();
    const prepared = await prepareZeropsManifest(join(parent, "does-not-exist"), deployment);

    expect(parseGeneratedManifest(prepared.yaml).zerops).toHaveLength(1);
    await prepared.cleanup();
  });

  it("keeps a nested source root consistent across build, deploy, and run", async () => {
    const workspace = await temporaryDirectory();
    const nestedDeployment: CompiledDeploymentTarget = {
      ...deployment,
      sourceRoot: "apps/web",
      build: {
        ...deployment.build,
        buildCommands: ["npm ci"],
        deployFiles: [".", "dist"],
      },
      run: { ...deployment.run, start: "node dist/server.js" },
    };

    const prepared = await prepareZeropsManifest(workspace, nestedDeployment);
    const setup = parseGeneratedManifest(prepared.yaml).zerops[0];
    expect(setup.build.deployFiles).toEqual(["apps/web", "apps/web/dist"]);
    expect(setup.build.buildCommands).toHaveLength(1);
    expect(setup.build.buildCommands?.[0]).toMatch(/^sh -lc /);
    expect(setup.build.buildCommands?.[0]).toContain("apps/web");
    expect(setup.run.start).toMatch(/^sh -lc /);
    expect(setup.run.start).toContain("apps/web");
    expect(setup.run.start).toContain("&& exec node dist/server.js");
    assertZeropsDeploymentContract(prepared.yaml, nestedDeployment);
    await prepared.cleanup();
  });

  it("shell-quotes a nested source root before directly executing the approved start", async () => {
    const workspace = await temporaryDirectory();
    const sourceRoot = "apps/web; printf unsafe";
    const sourceDirectory = join(workspace, sourceRoot);
    await mkdir(sourceDirectory, { recursive: true });
    const nestedDeployment: CompiledDeploymentTarget = {
      ...deployment,
      sourceRoot,
      build: { ...deployment.build, buildCommands: [], deployFiles: ["."] },
      run: { ...deployment.run, start: "pwd" },
    };

    const prepared = await prepareZeropsManifest(workspace, nestedDeployment);
    const start = parseGeneratedManifest(prepared.yaml).zerops[0].run.start;
    const { stdout } = await execFileAsync("sh", ["-lc", start], {
      cwd: workspace,
      encoding: "utf8",
    });
    expect(stdout.trim()).toBe(await realpath(sourceDirectory));
    await prepared.cleanup();
  });

  it("rejects a manifest whose generated plan is changed after approval", async () => {
    const workspace = await temporaryDirectory();
    const prepared = await prepareZeropsManifest(workspace, deployment);
    const manifest = parseGeneratedManifest(prepared.yaml);
    manifest.zerops[0].run.start = "node changed.js";

    expect(() =>
      assertZeropsDeploymentContract(stringifyYaml(manifest), deployment),
    ).toThrow("does not match the approved deployment plan");
    await prepared.cleanup();
  });
});

describe("loadZeropsManifest", () => {
  it("retains no-follow loading for the fixed TrialRun executor manifest", async () => {
    const workspace = await temporaryDirectory();
    const outside = join(workspace, "outside.yaml");
    await writeFile(outside, "zerops: []\n", "utf8");
    await symlink(outside, join(workspace, "zerops.yaml"));

    await expect(loadZeropsManifest(workspace)).rejects.toThrow();
  });
});
