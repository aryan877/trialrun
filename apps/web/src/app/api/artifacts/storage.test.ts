import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ArtifactNotFoundError,
  ArtifactRangeError,
  ArtifactStorageError,
  artifactResponseHeaders,
  openLocalArtifact,
  parseArtifactRange,
  readVerifiedArtifactBytes,
  s3ObjectUrl,
  signedS3GetHeaders,
  validateArtifactStorageKey,
  type S3ReadConfig,
} from "./storage";

const reviewId = "11111111-1111-4111-8111-111111111111";
const otherReviewId = "22222222-2222-4222-8222-222222222222";
const storageKey = validateArtifactStorageKey(`${reviewId}/base-home-screenshot.png`, reviewId);
const s3Config: S3ReadConfig = {
  endpoint: "https://objects.example.test/api",
  region: "us-east-1",
  bucket: "trialrun-evidence",
  accessKeyId: "ACCESSKEY",
  secretAccessKey: "secret",
  forcePathStyle: true,
};

async function streamBytes(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const reader = stream.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      chunks.push(Buffer.from(result.value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

describe("artifact storage boundaries", () => {
  it("accepts only the exact review-scoped one-segment storage key", () => {
    expect(storageKey).toEqual({
      key: `${reviewId}/base-home-screenshot.png`,
      fileName: "base-home-screenshot.png",
    });
    for (const unsafeKey of [
      `${otherReviewId}/base-home-screenshot.png`,
      `${reviewId}/../outside.txt`,
      `${reviewId}/nested/capture.png`,
      `${reviewId}/%2e%2e`,
      `${reviewId}/capture\\..\\secret`,
      `../${reviewId}/capture.png`,
    ]) {
      expect(() => validateArtifactStorageKey(unsafeKey, reviewId)).toThrow(ArtifactNotFoundError);
    }
  });

  it("normalizes one bounded byte range and rejects ambiguous or impossible ranges", () => {
    expect(parseArtifactRange(null, 10)).toBeUndefined();
    expect(parseArtifactRange("bytes=2-5", 10)).toEqual({ start: 2, end: 5, length: 4 });
    expect(parseArtifactRange("bytes=7-", 10)).toEqual({ start: 7, end: 9, length: 3 });
    expect(parseArtifactRange("bytes=-4", 10)).toEqual({ start: 6, end: 9, length: 4 });
    expect(parseArtifactRange("bytes=0-99", 10)).toEqual({ start: 0, end: 9, length: 10 });
    for (const invalidRange of ["bytes=10-", "bytes=6-5", "bytes=0-1,4-5", "items=0-1"]) {
      expect(() => parseArtifactRange(invalidRange, 10)).toThrow(ArtifactRangeError);
    }
    expect(() => parseArtifactRange(null, Number.MAX_SAFE_INTEGER + 1)).toThrow(
      ArtifactStorageError,
    );
  });

  it("accepts only bytes matching the durable size and SHA-256", async () => {
    const value = "real recorded proof";
    const digest = createHash("sha256").update(value).digest("hex");
    const body = () => new Response(value).body!;

    await expect(readVerifiedArtifactBytes(body(), value.length, digest, 1_024)).resolves.toEqual(
      Buffer.from(value),
    );
    await expect(
      readVerifiedArtifactBytes(body(), value.length, "0".repeat(64), 1_024),
    ).rejects.toBeInstanceOf(ArtifactStorageError);
    await expect(
      readVerifiedArtifactBytes(body(), value.length - 1, digest, 1_024),
    ).rejects.toBeInstanceOf(ArtifactStorageError);
    await expect(
      readVerifiedArtifactBytes(body(), value.length, digest, value.length - 1),
    ).rejects.toBeInstanceOf(ArtifactStorageError);
  });

  it("streams a local range only when the canonical file remains inside the root", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "trialrun-artifact-read-"));
    const artifactRoot = join(scratch, "artifacts");
    const reviewDirectory = join(artifactRoot, reviewId);
    const outsidePath = join(scratch, "outside.txt");
    await mkdir(reviewDirectory, { recursive: true });
    await writeFile(join(reviewDirectory, "base-home-screenshot.png"), "0123456789");
    await writeFile(outsidePath, "outside");
    await symlink(outsidePath, join(reviewDirectory, "escape.txt"));
    try {
      const opened = await openLocalArtifact({
        artifactRoot,
        workspaceRoot: scratch,
        storageKey,
        expectedSize: 10,
        rangeHeader: "bytes=2-5",
      });
      expect(opened.range).toEqual({ start: 2, end: 5, length: 4 });
      expect((await streamBytes(opened.body)).toString("utf8")).toBe("2345");

      const escapeKey = validateArtifactStorageKey(`${reviewId}/escape.txt`, reviewId);
      await expect(
        openLocalArtifact({
          artifactRoot,
          workspaceRoot: scratch,
          storageKey: escapeKey,
          expectedSize: 7,
          rangeHeader: null,
        }),
      ).rejects.toBeInstanceOf(ArtifactNotFoundError);
      await expect(
        openLocalArtifact({
          artifactRoot,
          workspaceRoot: scratch,
          storageKey,
          expectedSize: 9,
          rangeHeader: null,
        }),
      ).rejects.toBeInstanceOf(ArtifactStorageError);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("constructs bounded S3 URLs and produces the AWS-compatible signed GET", () => {
    expect(s3ObjectUrl(s3Config, storageKey).href).toBe(
      `https://objects.example.test/api/trialrun-evidence/${reviewId}/base-home-screenshot.png`,
    );
    expect(
      s3ObjectUrl(
        { ...s3Config, endpoint: "https://s3.amazonaws.com", forcePathStyle: false },
        storageKey,
      ).href,
    ).toBe(`https://trialrun-evidence.s3.amazonaws.com/${reviewId}/base-home-screenshot.png`);

    const url = new URL(`https://objects.example.test/trialrun-evidence/${reviewId}/capture.png`);
    const headers = signedS3GetHeaders({
      config: s3Config,
      url,
      now: new Date("2026-08-08T12:34:56.000Z"),
      range: { start: 0, end: 9, length: 10 },
    });
    expect(headers.get("x-amz-date")).toBe("20260808T123456Z");
    expect(headers.get("range")).toBe("bytes=0-9");
    expect(headers.get("authorization")).toBe(
      "AWS4-HMAC-SHA256 Credential=ACCESSKEY/20260808/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=dbb03040b2669b9db6ce4df34cbecfe4768eb537560698c6492fa96fb5df621c",
    );
    expect(url.search).toBe("");
  });

  it("serves only allowlisted media with private, integrity-bound headers", () => {
    const digest = "a".repeat(64);
    const headers = artifactResponseHeaders({
      fileName: "base-home-screenshot.png",
      mediaType: "image/png",
      sha256: digest,
      size: 10,
      range: { start: 2, end: 5, length: 4 },
    });
    expect(headers.get("content-type")).toBe("image/png");
    expect(headers.get("content-length")).toBe("4");
    expect(headers.get("content-range")).toBe("bytes 2-5/10");
    expect(headers.get("content-digest")).toBe(
      `sha-256=:${Buffer.from(digest, "hex").toString("base64")}:`,
    );
    expect(headers.get("cache-control")).toContain("no-store");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("content-security-policy")).toBeNull();

    const video = artifactResponseHeaders({
      fileName: "browser-review.webm",
      mediaType: "video/webm",
      sha256: digest,
      size: 10,
      range: undefined,
    });
    expect(video.get("content-type")).toBe("video/webm");
    expect(video.get("content-security-policy")).toBeNull();

    const unsafeType = artifactResponseHeaders({
      fileName: "record.txt",
      mediaType: "text/html",
      sha256: digest,
      size: 1,
      range: undefined,
    });
    expect(unsafeType.get("content-type")).toBe("application/octet-stream");
    expect(unsafeType.get("content-disposition")?.startsWith("attachment;")).toBe(true);
    expect(unsafeType.get("content-security-policy")).toBe("default-src 'none'; sandbox");
  });
});
