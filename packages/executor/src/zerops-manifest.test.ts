import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CompiledDeploymentTarget } from "@trialrun/domain";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { prepareZeropsManifest } from "./zerops-manifest";

const temporaryDirectories: string[] = [];

async function workspaceWithManifest(contents: string, basename = "zerops.yaml"): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "trialrun-manifest-test-"));
  temporaryDirectories.push(workspace);
  await writeFile(join(workspace, basename), contents, "utf8");
  return workspace;
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

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("prepareZeropsManifest", () => {
  it("patches only the selected setup with isolated bindings and readiness", async () => {
    const workspace = await workspaceWithManifest(`
zerops:
  - setup: worker
    run:
      start: node worker.js
  - setup: web
    customField: preserved
    deploy:
      temporaryShutdown: true
    run:
      ports:
        - port: 8080
      envVariables:
        DATABASE_URL: \${db_connectionString}
        TEST_API_KEY: should-not-collide
        NODE_ENV: test
      start: node server.js
`);

    const prepared = await prepareZeropsManifest(workspace, deployment);
    const parsed = parseYaml(prepared.yaml) as {
      zerops: Array<Record<string, unknown>>;
    };
    const selected = parsed.zerops.find(({ setup }) => setup === "web") as {
      customField: string;
      deploy: { temporaryShutdown: boolean; readinessCheck: unknown };
      run: { ports: unknown[]; envVariables: Record<string, string>; start: string };
    };
    expect(selected.customField).toBe("preserved");
    expect(selected.run.start).toBe("node server.js");
    expect(selected.run.envVariables).toEqual({
      DATABASE_URL: "${headdb_connectionString}",
      NODE_ENV: "test",
    });
    expect(selected.run.ports).toContainEqual({ port: 3_000, protocol: "TCP", httpSupport: true });
    expect(selected.deploy).toEqual({
      temporaryShutdown: true,
      readinessCheck: {
        httpGet: { port: 3_000, path: "/api/health" },
      },
    });
    expect(parsed.zerops[0]).toEqual({ setup: "worker", run: { start: "node worker.js" } });
    expect(prepared.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await lstat(prepared.path)).mode & 0o777).toBe(0o600);
    await prepared.cleanup();
    await expect(readFile(prepared.path)).rejects.toMatchObject({ code: "ENOENT" });
    await prepared.cleanup();
  });

  it("accepts the official zerops.yml fallback", async () => {
    const workspace = await workspaceWithManifest(
      "zerops:\n  - setup: web\n    run:\n      start: node server.js\n",
      "zerops.yml",
    );
    const prepared = await prepareZeropsManifest(workspace, deployment);
    await prepared.cleanup();
  });

  it("rejects duplicate setup names and UDP on the declared HTTP port", async () => {
    const duplicate = await workspaceWithManifest(
      "zerops:\n  - setup: web\n    run:\n      start: one\n  - setup: web\n    run:\n      start: two\n",
    );
    await expect(prepareZeropsManifest(duplicate, deployment)).rejects.toThrow("duplicate setup web");

    const udp = await workspaceWithManifest(
      "zerops:\n  - setup: web\n    run:\n      ports:\n        - port: 3000\n          protocol: UDP\n      start: node server.js\n",
    );
    await expect(prepareZeropsManifest(udp, deployment)).rejects.toThrow("as UDP");
  });

  it("does not follow an untrusted manifest symlink", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "trialrun-manifest-symlink-test-"));
    temporaryDirectories.push(workspace);
    const outside = join(workspace, "outside.yaml");
    await writeFile(outside, "zerops: []\n", "utf8");
    await symlink(outside, join(workspace, "zerops.yaml"));
    await expect(prepareZeropsManifest(workspace, deployment)).rejects.toThrow();
  });
});
