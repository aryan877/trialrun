import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { collectRepositoryEvidence } from "./repository-evidence";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("bounded repository evidence", () => {
  it("collects only allowlisted text files and refuses to follow symlinks", async () => {
    const root = await mkdtemp(join(tmpdir(), "trialrun-evidence-test-"));
    roots.push(root);
    await mkdir(join(root, "apps", "web"), { recursive: true });
    await writeFile(join(root, "zerops.yaml"), "zerops: []\n");
    await writeFile(join(root, "apps", "web", "package.json"), '{"name":"web"}\n');
    await writeFile(join(root, "apps", "web", "private.ts"), "do not collect\n");
    await symlink("/etc/passwd", join(root, ".env.example"));

    const bundle = await collectRepositoryEvidence(root);
    expect(bundle.files.map(({ path }) => path)).toEqual([
      "apps/web/package.json",
      "zerops.yaml",
    ]);
    expect(bundle.files.every(({ sha256 }) => /^[0-9a-f]{64}$/.test(sha256))).toBe(true);
  });

  it("requires the explicit first-release Zerops deployment contract", async () => {
    const root = await mkdtemp(join(tmpdir(), "trialrun-evidence-test-"));
    roots.push(root);
    await writeFile(join(root, "package.json"), '{}\n');
    await expect(collectRepositoryEvidence(root)).rejects.toThrow("requires a root zerops.yaml");
  });
});
