import { constants as fsConstants } from "node:fs";
import { lstat, open, opendir, realpath, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { z } from "zod";

export type RepositorySide = "base" | "head";

export interface RepositoryTreeEntry {
  readonly path: string;
  readonly type: "directory" | "file";
  readonly size: number | null;
}

export interface RepositoryTreePage {
  readonly entries: readonly RepositoryTreeEntry[];
  readonly nextCursor: string | null;
}

export interface RepositorySearchMatch {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

export interface RepositorySearchPage {
  readonly matches: readonly RepositorySearchMatch[];
  readonly nextCursor: string | null;
}

export interface RepositoryFileLine {
  readonly line: number;
  readonly text: string;
}

export interface RepositoryFileRange {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly totalLines: number;
  readonly lines: readonly RepositoryFileLine[];
}

export type RepositoryChangeStatus = "added" | "deleted" | "modified";

export interface RepositoryChange {
  readonly path: string;
  readonly status: RepositoryChangeStatus;
  readonly baseHash: string | null;
  readonly headHash: string | null;
}

export interface RepositoryDiff {
  readonly path: string;
  readonly status: RepositoryChangeStatus;
  readonly unifiedDiff: string;
  readonly truncated: boolean;
}

const SIDE_SCHEMA = z.enum(["base", "head"]);
const hasControlCharacters = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
const RELATIVE_PATH_SCHEMA = z
  .string()
  .max(1_024)
  .refine(
    (value) => !hasControlCharacters(value),
    "Paths cannot contain control characters.",
  )
  .refine((value) => !value.includes("\\"), "Paths must use forward slashes.")
  .refine((value) => !isAbsolute(value), "Absolute paths are not allowed.")
  .refine(
    (value) => value === "" || value.split("/").every((part) => part !== "" && part !== "." && part !== ".."),
    "Path traversal and empty path segments are not allowed.",
  );
const EXACT_FILE_PATH_SCHEMA = RELATIVE_PATH_SCHEMA.refine(
  (value) => value.length > 0,
  "A file path is required.",
);
const CURSOR_SCHEMA = z.string().regex(/^(0|[1-9]\d{0,8})$/).optional();

const CREATE_SCHEMA = z
  .object({
    baseDirectory: z.string().min(1).max(4_096).refine(isAbsolute, "Base directory must be absolute."),
    headDirectory: z.string().min(1).max(4_096).refine(isAbsolute, "Head directory must be absolute."),
  })
  .strict();
const TREE_SCHEMA = z
  .object({
    side: SIDE_SCHEMA,
    prefix: RELATIVE_PATH_SCHEMA.optional().default(""),
    cursor: CURSOR_SCHEMA,
    limit: z.number().int().min(1).max(200).optional().default(100),
  })
  .strict();
const SEARCH_SCHEMA = z
  .object({
    side: SIDE_SCHEMA,
    query: z.string().min(1).max(256).refine((value) => !value.includes("\0"), "Query cannot contain NUL bytes."),
    pathPrefix: RELATIVE_PATH_SCHEMA.optional().default(""),
    cursor: CURSOR_SCHEMA,
    limit: z.number().int().min(1).max(100).optional().default(50),
  })
  .strict();
const READ_SCHEMA = z
  .object({
    side: SIDE_SCHEMA,
    path: EXACT_FILE_PATH_SCHEMA,
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
  })
  .strict()
  .refine((value) => value.endLine >= value.startLine, "endLine must be at least startLine.")
  .refine((value) => value.endLine - value.startLine < 500, "A read may contain at most 500 lines.");
const DIFF_SCHEMA = z.object({ path: EXACT_FILE_PATH_SCHEMA }).strict();

const IGNORED_DIRECTORIES = new Set([
  ".cache",
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);
const BLOCKED_CREDENTIAL_NAMES = new Set([
  ".envrc",
  ".git-credentials",
  ".netrc",
  ".npmrc",
  "auth.json",
  "credentials.json",
  "netrc",
  "npmrc",
  "tokens.json",
]);

const MAX_TREE_ENTRIES = 10_000;
const MAX_SEARCH_FILES = 2_000;
const MAX_SEARCH_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_FILE_BYTES = 1024 * 1024;
const MAX_HASH_FILE_BYTES = 8 * 1024 * 1024;
const MAX_HASH_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_SEARCH_OUTPUT_BYTES = 64 * 1024;
const MAX_TREE_OUTPUT_BYTES = 256 * 1024;
const MAX_READ_OUTPUT_BYTES = 128 * 1024;
const MAX_CHANGE_OUTPUT_BYTES = 512 * 1024;
const MAX_DIFF_OUTPUT_BYTES = 64 * 1024;
const MAX_DIFF_LINES = 8_000;

interface CanonicalRoot {
  readonly path: string;
}

interface OpenedFile {
  readonly bytes: Buffer;
  readonly size: number;
}

function isContained(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== ".." && !isAbsolute(pathFromRoot));
}

function blockedCredentialPath(path: string): boolean {
  const name = path.split("/").at(-1)?.toLowerCase() ?? "";
  if (BLOCKED_CREDENTIAL_NAMES.has(name)) return true;
  if (/\.(key|pem|p12|pfx)$/.test(name)) return true;
  if (/^id_(?:dsa|ecdsa|ed25519|rsa)(?:\.|$)/.test(name)) return true;
  if (/\.(?:auto\.)?tfvars(?:\.json)?$/.test(name)) return true;
  if (name === ".env") return true;
  if (name.startsWith(".env.")) {
    return !/\.(example|examples|sample|template)$/.test(name);
  }
  return false;
}

function outputBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function parseCursor(cursor: string | undefined): number {
  return cursor === undefined ? 0 : Number.parseInt(cursor, 10);
}

function page<T>(values: readonly T[], cursor: string | undefined, limit: number): { readonly values: readonly T[]; readonly nextCursor: string | null } {
  const start = parseCursor(cursor);
  if (start > values.length) throw new Error("Cursor is outside the current result set.");
  const end = Math.min(start + limit, values.length);
  return {
    values: values.slice(start, end),
    nextCursor: end < values.length ? String(end) : null,
  };
}

function decodeUtf8(bytes: Buffer, path: string): string {
  if (bytes.includes(0)) throw new Error(`Binary files cannot be read: ${path}`);
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error(`File is not valid UTF-8: ${path}`);
  }
}

function splitLines(text: string): readonly string[] {
  if (text.length === 0) return [];
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

async function canonicalDirectory(path: string, label: string): Promise<CanonicalRoot> {
  if ((await lstat(path)).isSymbolicLink()) throw new Error(`${label} cannot be a symbolic link.`);
  const canonical = await realpath(path);
  const metadata = await stat(canonical);
  if (!metadata.isDirectory()) throw new Error(`${label} must be a directory.`);
  return { path: canonical };
}

export class RepositoryView {
  private constructor(
    private readonly baseRoot: CanonicalRoot,
    private readonly headRoot: CanonicalRoot,
  ) {}

  static async create(input: { readonly baseDirectory: string; readonly headDirectory: string }): Promise<RepositoryView> {
    const parsed = CREATE_SCHEMA.parse(input);
    const [baseRoot, headRoot] = await Promise.all([
      canonicalDirectory(parsed.baseDirectory, "baseDirectory"),
      canonicalDirectory(parsed.headDirectory, "headDirectory"),
    ]);
    if (baseRoot.path === headRoot.path) throw new Error("Base and head directories must be different.");
    if (isContained(baseRoot.path, headRoot.path) || isContained(headRoot.path, baseRoot.path)) {
      throw new Error("Base and head directories cannot contain one another.");
    }
    return new RepositoryView(baseRoot, headRoot);
  }

  async listTree(input: {
    readonly side: RepositorySide;
    readonly prefix?: string;
    readonly cursor?: string;
    readonly limit?: number;
  }): Promise<RepositoryTreePage> {
    const parsed = TREE_SCHEMA.parse(input);
    const entries = await this.collectTree(parsed.side, parsed.prefix);
    const result = page(entries, parsed.cursor, parsed.limit);
    const response = { entries: result.values, nextCursor: result.nextCursor };
    if (outputBytes(response) > MAX_TREE_OUTPUT_BYTES) throw new Error("Repository tree output budget exceeded.");
    return response;
  }

  async searchText(input: {
    readonly side: RepositorySide;
    readonly query: string;
    readonly pathPrefix?: string;
    readonly cursor?: string;
    readonly limit?: number;
  }): Promise<RepositorySearchPage> {
    const parsed = SEARCH_SCHEMA.parse(input);
    const files = (await this.collectTree(parsed.side, parsed.pathPrefix)).filter(
      (entry): entry is RepositoryTreeEntry & { readonly type: "file" } => entry.type === "file",
    );
    if (files.length > MAX_SEARCH_FILES) throw new Error("Repository search file-count budget exceeded.");

    const matches: RepositorySearchMatch[] = [];
    let bytesRead = 0;
    let resultBytes = 2;
    for (const file of files) {
      const opened = await this.readSafeFile(parsed.side, file.path, MAX_TEXT_FILE_BYTES);
      bytesRead += opened.size;
      if (bytesRead > MAX_SEARCH_BYTES) throw new Error("Repository search byte budget exceeded.");
      const lines = splitLines(decodeUtf8(opened.bytes, file.path));
      for (let index = 0; index < lines.length; index += 1) {
        const text = lines[index];
        if (text !== undefined && text.includes(parsed.query)) {
          const match = { path: file.path, line: index + 1, text };
          resultBytes += outputBytes(match);
          if (resultBytes > MAX_SEARCH_OUTPUT_BYTES) throw new Error("Repository search output budget exceeded.");
          matches.push(match);
        }
      }
    }
    const result = page(matches, parsed.cursor, parsed.limit);
    return { matches: result.values, nextCursor: result.nextCursor };
  }

  async readFile(input: {
    readonly side: RepositorySide;
    readonly path: string;
    readonly startLine: number;
    readonly endLine: number;
  }): Promise<RepositoryFileRange> {
    const parsed = READ_SCHEMA.parse(input);
    const opened = await this.readSafeFile(parsed.side, parsed.path, MAX_TEXT_FILE_BYTES);
    const allLines = splitLines(decodeUtf8(opened.bytes, parsed.path));
    const selected = allLines.slice(parsed.startLine - 1, parsed.endLine).map((text, index) => ({
      line: parsed.startLine + index,
      text,
    }));
    const result: RepositoryFileRange = {
      path: parsed.path,
      startLine: selected[0]?.line ?? parsed.startLine,
      endLine: selected.at(-1)?.line ?? parsed.startLine - 1,
      totalLines: allLines.length,
      lines: selected,
    };
    if (outputBytes(result) > MAX_READ_OUTPUT_BYTES) throw new Error("Repository read output budget exceeded.");
    return result;
  }

  async listChanges(): Promise<readonly RepositoryChange[]> {
    const [baseEntries, headEntries] = await Promise.all([
      this.collectTree("base", ""),
      this.collectTree("head", ""),
    ]);
    const baseFiles = new Set(baseEntries.filter((entry) => entry.type === "file").map((entry) => entry.path));
    const headFiles = new Set(headEntries.filter((entry) => entry.type === "file").map((entry) => entry.path));
    const paths = [...new Set([...baseFiles, ...headFiles])].sort((left, right) => left.localeCompare(right));
    let totalBytes = 0;
    let changeOutputBytes = 2;
    const changes: RepositoryChange[] = [];
    for (const path of paths) {
      const base = baseFiles.has(path) ? await this.hashFile("base", path) : null;
      const head = headFiles.has(path) ? await this.hashFile("head", path) : null;
      totalBytes += (base?.size ?? 0) + (head?.size ?? 0);
      if (totalBytes > MAX_HASH_TOTAL_BYTES) throw new Error("Repository comparison byte budget exceeded.");
      if (base?.hash === head?.hash) continue;
      const status: RepositoryChangeStatus = base === null ? "added" : head === null ? "deleted" : "modified";
      const change = { path, status, baseHash: base?.hash ?? null, headHash: head?.hash ?? null };
      changeOutputBytes += outputBytes(change);
      if (changeOutputBytes > MAX_CHANGE_OUTPUT_BYTES) throw new Error("Repository comparison output budget exceeded.");
      changes.push(change);
    }
    return changes;
  }

  async readDiff(input: { readonly path: string }): Promise<RepositoryDiff> {
    const parsed = DIFF_SCHEMA.parse(input);
    const [baseExists, headExists] = await Promise.all([
      this.safeFileExists("base", parsed.path),
      this.safeFileExists("head", parsed.path),
    ]);
    if (!baseExists && !headExists) throw new Error(`Changed path does not exist: ${parsed.path}`);
    const [baseText, headText] = await Promise.all([
      baseExists ? this.readTextForDiff("base", parsed.path) : Promise.resolve(""),
      headExists ? this.readTextForDiff("head", parsed.path) : Promise.resolve(""),
    ]);
    if (baseExists && headExists && baseText === headText) throw new Error(`Path is unchanged: ${parsed.path}`);
    const status: RepositoryChangeStatus = !baseExists ? "added" : !headExists ? "deleted" : "modified";
    const fullDiff = buildUnifiedDiff(parsed.path, baseText, headText, status);
    const bounded = boundDiff(fullDiff);
    return { path: parsed.path, status, unifiedDiff: bounded.text, truncated: bounded.truncated };
  }

  private root(side: RepositorySide): CanonicalRoot {
    return side === "base" ? this.baseRoot : this.headRoot;
  }

  private async resolveExisting(side: RepositorySide, relativePath: string): Promise<string> {
    const root = this.root(side).path;
    if (relativePath === "") return root;
    if (blockedCredentialPath(relativePath)) throw new Error(`Credential files are not accessible: ${relativePath}`);
    let current = root;
    const parts = relativePath.split("/");
    for (const [index, part] of parts.entries()) {
      current = resolve(current, part);
      if (!isContained(root, current)) throw new Error("Resolved path escapes the repository root.");
      const openedMetadata = await lstat(current);
      if (openedMetadata.isSymbolicLink()) throw new Error(`Symbolic links are not accessible: ${relativePath}`);
      if (openedMetadata.isDirectory() && IGNORED_DIRECTORIES.has(part)) {
        throw new Error(`Ignored directories are not accessible: ${relativePath}`);
      }
      const canonical = await realpath(current);
      if (!isContained(root, canonical)) throw new Error("Resolved path escapes the repository root.");
      if (!openedMetadata.isDirectory() && index < parts.length - 1) {
        throw new Error(`Path component is not a directory: ${relativePath}`);
      }
    }
    return current;
  }

  private async collectTree(side: RepositorySide, prefix: string): Promise<readonly RepositoryTreeEntry[]> {
    const start = await this.resolveExisting(side, prefix);
    const root = this.root(side).path;
    const startMetadata = await stat(start);
    const entries: RepositoryTreeEntry[] = [];
    if (startMetadata.isFile()) {
      entries.push({ path: prefix, type: "file", size: startMetadata.size });
      return entries;
    }
    if (!startMetadata.isDirectory()) return entries;

    const visit = async (directory: string): Promise<void> => {
      const directoryHandle = await opendir(directory);
      for await (const directoryEntry of directoryHandle) {
        if (directoryEntry.isSymbolicLink()) continue;
        const absolute = resolve(directory, directoryEntry.name);
        const metadata = await lstat(absolute).catch(() => null);
        if (metadata === null || metadata.isSymbolicLink()) continue;
        const canonical = await realpath(absolute).catch(() => null);
        if (canonical === null || !isContained(root, canonical)) continue;
        const relativePath = relative(root, absolute).split(sep).join("/");
        if (!RELATIVE_PATH_SCHEMA.safeParse(relativePath).success) continue;
        if (blockedCredentialPath(relativePath)) continue;
        if (metadata.isDirectory()) {
          if (IGNORED_DIRECTORIES.has(directoryEntry.name)) continue;
          entries.push({ path: relativePath, type: "directory", size: null });
          if (entries.length > MAX_TREE_ENTRIES) throw new Error("Repository tree entry budget exceeded.");
          await visit(absolute);
        } else if (metadata.isFile()) {
          entries.push({ path: relativePath, type: "file", size: metadata.size });
          if (entries.length > MAX_TREE_ENTRIES) throw new Error("Repository tree entry budget exceeded.");
        }
      }
    };
    await visit(start);
    return entries.sort((left, right) => left.path.localeCompare(right.path));
  }

  private async readSafeFile(side: RepositorySide, path: string, maximumBytes: number): Promise<OpenedFile> {
    const absolute = await this.resolveExisting(side, path);
    const handle = await open(absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile()) throw new Error(`Path is not a regular file: ${path}`);
      const revalidatedAbsolute = await this.resolveExisting(side, path);
      const pathMetadata = await lstat(revalidatedAbsolute);
      if (pathMetadata.dev !== metadata.dev || pathMetadata.ino !== metadata.ino) {
        throw new Error(`File changed while it was being opened: ${path}`);
      }
      if (metadata.size > maximumBytes) throw new Error(`File exceeds the ${maximumBytes}-byte limit: ${path}`);
      const storage = Buffer.alloc(maximumBytes + 1);
      let offset = 0;
      while (offset < storage.length) {
        const { bytesRead } = await handle.read(storage, offset, storage.length - offset, null);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      if (offset > maximumBytes) throw new Error(`File exceeds the ${maximumBytes}-byte limit: ${path}`);
      return { bytes: storage.subarray(0, offset), size: offset };
    } finally {
      await handle.close();
    }
  }

  private async safeFileExists(side: RepositorySide, path: string): Promise<boolean> {
    try {
      const absolute = await this.resolveExisting(side, path);
      return (await stat(absolute)).isFile();
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
      throw error;
    }
  }

  private async hashFile(side: RepositorySide, path: string): Promise<{ readonly hash: string; readonly size: number }> {
    const opened = await this.readSafeFile(side, path, MAX_HASH_FILE_BYTES);
    return { hash: createHash("sha256").update(opened.bytes).digest("hex"), size: opened.size };
  }

  private async readTextForDiff(side: RepositorySide, path: string): Promise<string> {
    const opened = await this.readSafeFile(side, path, MAX_TEXT_FILE_BYTES);
    return decodeUtf8(opened.bytes, path);
  }
}

export function createRepositoryView(input: {
  readonly baseDirectory: string;
  readonly headDirectory: string;
}): Promise<RepositoryView> {
  return RepositoryView.create(input);
}

function buildUnifiedDiff(
  path: string,
  baseText: string,
  headText: string,
  status: RepositoryChangeStatus,
): string {
  const oldLines = splitLines(baseText);
  const newLines = splitLines(headText);
  const oldHeader = status === "added" ? "/dev/null" : `a/${path}`;
  const newHeader = status === "deleted" ? "/dev/null" : `b/${path}`;
  let commonPrefix = 0;
  while (oldLines[commonPrefix] !== undefined && oldLines[commonPrefix] === newLines[commonPrefix]) {
    commonPrefix += 1;
  }
  let commonSuffix = 0;
  while (
    commonSuffix < oldLines.length - commonPrefix &&
    commonSuffix < newLines.length - commonPrefix &&
    oldLines[oldLines.length - commonSuffix - 1] === newLines[newLines.length - commonSuffix - 1]
  ) {
    commonSuffix += 1;
  }

  const context = 3;
  const oldChangeEnd = oldLines.length - commonSuffix;
  const newChangeEnd = newLines.length - commonSuffix;
  const oldHunkStart = Math.max(0, commonPrefix - context);
  const newHunkStart = Math.max(0, commonPrefix - context);
  const oldHunkEnd = Math.min(oldLines.length, oldChangeEnd + context);
  const newHunkEnd = Math.min(newLines.length, newChangeEnd + context);
  const oldCount = oldHunkEnd - oldHunkStart;
  const newCount = newHunkEnd - newHunkStart;
  const oldStart = oldCount === 0 ? 0 : oldHunkStart + 1;
  const newStart = newCount === 0 ? 0 : newHunkStart + 1;
  const lines = [`--- ${oldHeader}`, `+++ ${newHeader}`, `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`];
  for (let index = oldHunkStart; index < commonPrefix; index += 1) lines.push(` ${oldLines[index] ?? ""}`);
  for (let index = commonPrefix; index < oldChangeEnd; index += 1) lines.push(`-${oldLines[index] ?? ""}`);
  for (let index = commonPrefix; index < newChangeEnd; index += 1) lines.push(`+${newLines[index] ?? ""}`);
  for (let index = oldChangeEnd; index < oldHunkEnd; index += 1) lines.push(` ${oldLines[index] ?? ""}`);
  return `${lines.join("\n")}\n`;
}

function boundDiff(diff: string): { readonly text: string; readonly truncated: boolean } {
  const lines = diff.split("\n");
  const selected: string[] = [];
  let bytes = 0;
  let truncated = false;
  const marker = "... diff truncated by TrialRun safety budget ...";
  const markerBytes = Buffer.byteLength(marker, "utf8");
  for (const line of lines) {
    const lineBytes = Buffer.byteLength(`${line}\n`, "utf8");
    if (selected.length >= MAX_DIFF_LINES - 1 || bytes + lineBytes > MAX_DIFF_OUTPUT_BYTES - markerBytes) {
      truncated = true;
      break;
    }
    selected.push(line);
    bytes += lineBytes;
  }
  if (truncated) selected.push(marker);
  return { text: selected.join("\n"), truncated };
}
