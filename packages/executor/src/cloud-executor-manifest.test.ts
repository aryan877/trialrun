import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { CompiledDeploymentTarget } from "@trialrun/domain";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { assertZeropsDeploymentContract } from "./zerops-manifest";

const manifestPath = fileURLToPath(
  new URL("../../../ops/cloud-executor.zerops.yaml", import.meta.url),
);
const rootManifestPath = fileURLToPath(new URL("../../../zerops.yaml", import.meta.url));

const executorDeployment: CompiledDeploymentTarget = {
  side: "executor",
  logicalService: "executor",
  hostname: "executor",
  sourceRoot: ".",
  setup: "executor",
  sha: null,
  port: 3_000,
  healthPath: "/health",
  environmentBindings: [],
  secretBindings: [],
};

const executorManifestSchema = z.strictObject({
  zerops: z.tuple([
    z.strictObject({
      setup: z.literal("executor"),
      build: z.strictObject({
        base: z.literal("ubuntu/nodejs@24"),
        deployFiles: z.literal("."),
      }),
      deploy: z.strictObject({
        readinessCheck: z.strictObject({
          httpGet: z.strictObject({ port: z.literal(3_000), path: z.literal("/health") }),
        }),
      }),
      run: z.strictObject({
        base: z.literal("ubuntu/nodejs@24"),
        prepareCommands: z.tuple([
          z.literal(
            "PLAYWRIGHT_BROWSERS_PATH=/home/zerops/.cache/ms-playwright PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=120000 npx --yes playwright@1.62.1 install --with-deps --only-shell chromium",
          ),
        ]),
        envVariables: z.strictObject({
          PLAYWRIGHT_BROWSERS_PATH: z.literal("/home/zerops/.cache/ms-playwright"),
        }),
        ports: z.tuple([z.strictObject({ port: z.literal(3_000), httpSupport: z.literal(true) })]),
        start: z.literal("./node_modules/.bin/tsx src/index.ts"),
      }),
    }),
  ]),
});

describe("cloud executor Zerops contract", () => {
  it("pins the native Node runtime and headless-only Chromium without Docker", async () => {
    const yaml = await readFile(manifestPath, "utf8");
    expect(() => executorManifestSchema.parse(parseYaml(yaml))).not.toThrow();
    expect(() => assertZeropsDeploymentContract(yaml, executorDeployment)).not.toThrow();
    expect(yaml).not.toMatch(/docker|playwright\/v/i);
  });

  it("rejects stale Docker, browser, cache, and start contracts", async () => {
    const yaml = await readFile(manifestPath, "utf8");
    for (const changed of [
      yaml.replace("ubuntu/nodejs@24", "alpine/docker@26.1.5"),
      yaml.replace("--only-shell chromium", "chromium"),
      yaml.replace("/home/zerops/.cache/ms-playwright", "/tmp/browsers"),
      yaml.replace("./node_modules/.bin/tsx src/index.ts", "sh -lc 'npm start'"),
    ]) {
      expect(() => assertZeropsDeploymentContract(changed, executorDeployment)).toThrow();
    }
  });

  it("keeps the standalone and root executor runtime contracts synchronized", async () => {
    const standalone = executorManifestSchema.parse(parseYaml(await readFile(manifestPath, "utf8")));
    const rootDocument = z
      .object({
        zerops: z.array(z.looseObject({ setup: z.string() })),
      })
      .parse(parseYaml(await readFile(rootManifestPath, "utf8")));
    const rootExecutor = rootDocument.zerops.find(({ setup }) => setup === "executor");
    if (!rootExecutor) throw new Error("Root zerops.yaml is missing the executor setup.");

    expect(rootExecutor.deploy).toEqual(standalone.zerops[0].deploy);
    expect(rootExecutor.run).toEqual(standalone.zerops[0].run);
    expect(() =>
      assertZeropsDeploymentContract(
        stringifyYaml({ zerops: [rootExecutor] }),
        executorDeployment,
      ),
    ).toThrow(/build/);
  });
});
