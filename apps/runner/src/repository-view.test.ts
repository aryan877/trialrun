import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createRepositoryView, type RepositoryView } from "./repository-view";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture(): Promise<{
  readonly root: string;
  readonly base: string;
  readonly head: string;
  readonly view: RepositoryView;
}> {
  const root = await mkdtemp(join(tmpdir(), "trialrun-repository-view-"));
  temporaryRoots.push(root);
  const base = join(root, "base");
  const head = join(root, "head");
  await Promise.all([mkdir(base), mkdir(head)]);
  return { root, base, head, view: await createRepositoryView({ baseDirectory: base, headDirectory: head }) };
}

async function put(root: string, path: string, contents: string | Buffer): Promise<void> {
  const parts = path.split("/");
  parts.pop();
  if (parts.length > 0) await mkdir(join(root, ...parts), { recursive: true });
  await writeFile(join(root, path), contents);
}

describe("RepositoryView path and content security", () => {
  it("rejects traversal and absolute paths through runtime schemas", async () => {
    const { head, view } = await fixture();
    await put(head, "safe.txt", "safe\n");

    await expect(view.readFile({ side: "head", path: "../safe.txt", startLine: 1, endLine: 1 })).rejects.toThrow();
    await expect(view.readFile({ side: "head", path: "/etc/passwd", startLine: 1, endLine: 1 })).rejects.toThrow();
    await expect(view.listTree({ side: "head", prefix: "src/../safe.txt" })).rejects.toThrow();
  });

  it("never follows repository symlinks, including links that remain inside the root", async () => {
    const { head, root, view } = await fixture();
    await put(head, "real/inside.txt", "inside\n");
    await put(root, "outside.txt", "outside\n");
    await Promise.all([
      symlink(join(root, "outside.txt"), join(head, "outside-link.txt")),
      symlink(join(head, "real", "inside.txt"), join(head, "inside-link.txt")),
    ]);

    const tree = await view.listTree({ side: "head", limit: 100 });
    expect(tree.entries.map((entry) => entry.path)).toEqual(["real", "real/inside.txt"]);
    await expect(view.readFile({ side: "head", path: "outside-link.txt", startLine: 1, endLine: 1 })).rejects.toThrow("Symbolic links");
    await expect(view.readFile({ side: "head", path: "inside-link.txt", startLine: 1, endLine: 1 })).rejects.toThrow("Symbolic links");
  });

  it("blocks credential-like files and ignored build metadata but allows examples", async () => {
    const { head, view } = await fixture();
    await Promise.all([
      put(head, ".env", "SECRET=one\n"),
      put(head, ".env.local", "SECRET=two\n"),
      put(head, ".env.example", "SAFE_NAME=\n"),
      put(head, "auth.json", "{}\n"),
      put(head, ".git-credentials", "https://token@example.test\n"),
      put(head, "id_ed25519", "private\n"),
      put(head, "terraform.tfvars", "password = \"secret\"\n"),
      put(head, "certificate.pem", "private\n"),
      put(head, ".git/config", "secret\n"),
      put(head, "dist/output.js", "generated\n"),
    ]);

    const tree = await view.listTree({ side: "head", limit: 100 });
    expect(tree.entries.map((entry) => entry.path)).toEqual([".env.example"]);
    await expect(view.readFile({ side: "head", path: ".env", startLine: 1, endLine: 1 })).rejects.toThrow("Credential files");
    await expect(view.listTree({ side: "head", prefix: "dist" })).rejects.toThrow("Ignored directories");
  });

  it("omits file names containing control characters from every evidence surface", async () => {
    const { head, view } = await fixture();
    await Promise.all([
      put(head, "safe.txt", "safe\n"),
      put(head, "forged\n+++ b/injected.ts", "malicious\n"),
    ]);

    expect((await view.listTree({ side: "head" })).entries.map(({ path }) => path)).toEqual([
      "safe.txt",
    ]);
    expect(await view.listChanges()).toEqual([
      expect.objectContaining({ path: "safe.txt", status: "added" }),
    ]);
  });

  it("rejects binary, invalid UTF-8, and oversized content", async () => {
    const { head, view } = await fixture();
    await Promise.all([
      put(head, "binary.dat", Buffer.from([65, 0, 66])),
      put(head, "invalid.txt", Buffer.from([0xc3, 0x28])),
      put(head, "large.txt", Buffer.alloc(1024 * 1024 + 1, 65)),
    ]);

    await expect(view.readFile({ side: "head", path: "binary.dat", startLine: 1, endLine: 1 })).rejects.toThrow("Binary files");
    await expect(view.readFile({ side: "head", path: "invalid.txt", startLine: 1, endLine: 1 })).rejects.toThrow("valid UTF-8");
    await expect(view.readFile({ side: "head", path: "large.txt", startLine: 1, endLine: 1 })).rejects.toThrow("1048576-byte limit");
  });
});

describe("RepositoryView bounded repository evidence", () => {
  it("lists a stable recursive tree with cursor pagination and prefix filtering", async () => {
    const { head, view } = await fixture();
    await Promise.all([
      put(head, "a.txt", "a\n"),
      put(head, "src/b.txt", "b\n"),
      put(head, "src/c.txt", "c\n"),
    ]);

    const first = await view.listTree({ side: "head", limit: 2 });
    expect(first.entries.map((entry) => entry.path)).toEqual(["a.txt", "src"]);
    expect(first.nextCursor).toBe("2");
    if (first.nextCursor === null) throw new Error("Expected another tree page.");
    const second = await view.listTree({ side: "head", cursor: first.nextCursor, limit: 2 });
    expect(second.entries.map((entry) => entry.path)).toEqual(["src/b.txt", "src/c.txt"]);
    expect(second.nextCursor).toBeNull();
    const prefixed = await view.listTree({ side: "head", prefix: "src", limit: 10 });
    expect(prefixed.entries.map((entry) => entry.path)).toEqual(["src/b.txt", "src/c.txt"]);
  });

  it("returns literal search matches with exact paths, one-based lines, text, and pages", async () => {
    const { head, view } = await fixture();
    await Promise.all([
      put(head, "src/first.ts", "const target = 1;\nnot a match\ntarget();\n"),
      put(head, "src/second.ts", "target in second\n"),
      put(head, "other.txt", "target outside prefix\n"),
    ]);

    const first = await view.searchText({ side: "head", query: "target", pathPrefix: "src", limit: 2 });
    expect(first.matches).toEqual([
      { path: "src/first.ts", line: 1, text: "const target = 1;" },
      { path: "src/first.ts", line: 3, text: "target();" },
    ]);
    expect(first.nextCursor).toBe("2");
    const second = await view.searchText({ side: "head", query: "target", pathPrefix: "src", cursor: "2", limit: 2 });
    expect(second.matches).toEqual([{ path: "src/second.ts", line: 1, text: "target in second" }]);
    expect(second.nextCursor).toBeNull();
  });

  it("reads exact inclusive line ranges with citation metadata", async () => {
    const { head, view } = await fixture();
    await put(head, "notes.txt", "first\r\nsecond\r\nthird\r\nfourth\r\n");

    await expect(view.readFile({ side: "head", path: "notes.txt", startLine: 2, endLine: 3 })).resolves.toEqual({
      path: "notes.txt",
      startLine: 2,
      endLine: 3,
      totalLines: 4,
      lines: [
        { line: 2, text: "second" },
        { line: 3, text: "third" },
      ],
    });
  });

  it("reports exact add/delete/modify hashes, omits unchanged files, and scopes by side", async () => {
    const { base, head, view } = await fixture();
    await Promise.all([
      put(base, "deleted.txt", "deleted\n"),
      put(base, "modified.txt", "before\n"),
      put(base, "same.txt", "same\n"),
      put(head, "added.txt", "added\n"),
      put(head, "modified.txt", "after\n"),
      put(head, "same.txt", "same\n"),
    ]);

    const changes = await view.listChanges();
    expect(changes.map(({ path, status }) => ({ path, status }))).toEqual([
      { path: "added.txt", status: "added" },
      { path: "deleted.txt", status: "deleted" },
      { path: "modified.txt", status: "modified" },
    ]);
    expect(changes.every((change) => change.baseHash === null || /^[a-f0-9]{64}$/.test(change.baseHash))).toBe(true);
    expect(changes.every((change) => change.headHash === null || /^[a-f0-9]{64}$/.test(change.headHash))).toBe(true);
    expect(changes.find((change) => change.path === "added.txt")).toMatchObject({ baseHash: null });
    expect(changes.find((change) => change.path === "deleted.txt")).toMatchObject({ headHash: null });
    await expect(view.readFile({ side: "base", path: "modified.txt", startLine: 1, endLine: 1 })).resolves.toMatchObject({ lines: [{ line: 1, text: "before" }] });
    await expect(view.readFile({ side: "head", path: "modified.txt", startLine: 1, endLine: 1 })).resolves.toMatchObject({ lines: [{ line: 1, text: "after" }] });
  });

  it("returns bounded unified diffs for exact modified, added, and deleted paths", async () => {
    const { base, head, view } = await fixture();
    await Promise.all([
      put(base, "modified.txt", "old\n"),
      put(head, "modified.txt", "new\n"),
      put(head, "added.txt", "added\n"),
      put(base, "deleted.txt", "deleted\n"),
      put(base, "same.txt", "same\n"),
      put(head, "same.txt", "same\n"),
      put(base, "bounded.txt", `${"x".repeat(200)}\n`.repeat(400)),
      put(head, "bounded.txt", `${"y".repeat(200)}\n`.repeat(400)),
    ]);

    await expect(view.readDiff({ path: "modified.txt" })).resolves.toMatchObject({
      path: "modified.txt",
      status: "modified",
      unifiedDiff: "--- a/modified.txt\n+++ b/modified.txt\n@@ -1,1 +1,1 @@\n-old\n+new\n",
      truncated: false,
    });
    expect((await view.readDiff({ path: "added.txt" })).unifiedDiff).toContain("--- /dev/null\n+++ b/added.txt");
    expect((await view.readDiff({ path: "deleted.txt" })).unifiedDiff).toContain("--- a/deleted.txt\n+++ /dev/null");
    await expect(view.readDiff({ path: "same.txt" })).rejects.toThrow("unchanged");
    const bounded = await view.readDiff({ path: "bounded.txt" });
    expect(bounded.truncated).toBe(true);
    expect(Buffer.byteLength(bounded.unifiedDiff, "utf8")).toBeLessThanOrEqual(64 * 1024);
    expect(bounded.unifiedDiff).toContain("diff truncated");
  });
});
