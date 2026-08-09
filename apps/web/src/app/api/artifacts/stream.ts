import type { NextRequest } from "next/server";

import { artifacts } from "@trialrun/db";

import { serverEnv, workspaceRoot } from "@/lib/env";

import {
  ArtifactNotFoundError,
  ArtifactRangeError,
  ArtifactStorageError,
  artifactResponseHeaders,
  fetchS3Artifact,
  openLocalArtifact,
  parseArtifactRange,
  readVerifiedArtifactBytes,
  rangeNotSatisfiableHeaders,
  validateArtifactStorageKey,
  type ArtifactByteRange,
  type ValidatedArtifactKey,
} from "./storage";

export const privateNoStoreHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
} as const;

export function emptyArtifactResponse(
  status: number,
  headers: HeadersInit = privateNoStoreHeaders,
): Response {
  return new Response(null, { status, headers });
}

async function discard(response: Response): Promise<void> {
  if (!response.body) return;
  try {
    await response.body.cancel();
  } catch {
    // The upstream may have already closed an unsuccessful response.
  }
}

function expectedContentRange(range: ArtifactByteRange, size: number): string {
  return `bytes ${range.start}-${range.end}/${size}`;
}

function verifiedResponse(input: {
  readonly bytes: Buffer;
  readonly artifact: typeof artifacts.$inferSelect;
  readonly storageKey: ValidatedArtifactKey;
  readonly range: ArtifactByteRange | undefined;
}): Response {
  const body = input.range
    ? input.bytes.subarray(input.range.start, input.range.end + 1)
    : input.bytes;
  return new Response(Uint8Array.from(body), {
    status: input.range ? 206 : 200,
    headers: artifactResponseHeaders({
      fileName: input.storageKey.fileName,
      mediaType: input.artifact.mediaType,
      sha256: input.artifact.sha256,
      size: input.artifact.sizeBytes,
      range: input.range,
    }),
  });
}

async function s3Response(input: {
  readonly artifact: typeof artifacts.$inferSelect;
  readonly storageKey: ValidatedArtifactKey;
  readonly rangeHeader: string | null;
}): Promise<Response> {
  const env = serverEnv();
  if (!env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    throw new ArtifactStorageError("S3 artifact credentials are unavailable.");
  }
  const range = parseArtifactRange(input.rangeHeader, input.artifact.sizeBytes);
  const upstream = await fetchS3Artifact({
    config: {
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
    },
    storageKey: input.storageKey,
    range,
  });
  if (upstream.status === 404) {
    await discard(upstream);
    throw new ArtifactNotFoundError("Artifact object is unavailable.");
  }
  const expectedStatus = range ? 206 : 200;
  if (upstream.status !== expectedStatus || !upstream.body) {
    await discard(upstream);
    throw new ArtifactStorageError("S3 returned an invalid artifact response.");
  }
  const expectedLength = range?.length ?? input.artifact.sizeBytes;
  const upstreamLength = upstream.headers.get("content-length");
  const upstreamSha256 = upstream.headers.get("x-amz-meta-sha256");
  if (
    (upstreamLength !== null && Number(upstreamLength) !== expectedLength) ||
    upstreamSha256?.toLowerCase() !== input.artifact.sha256.toLowerCase() ||
    (range &&
      upstream.headers.get("content-range") !==
        expectedContentRange(range, input.artifact.sizeBytes))
  ) {
    await discard(upstream);
    throw new ArtifactStorageError("S3 artifact metadata did not match the durable record.");
  }
  return new Response(upstream.body, {
    status: expectedStatus,
    headers: artifactResponseHeaders({
      fileName: input.storageKey.fileName,
      mediaType: input.artifact.mediaType,
      sha256: input.artifact.sha256,
      size: input.artifact.sizeBytes,
      range,
    }),
  });
}

export async function streamStoredArtifact(
  request: NextRequest,
  artifact: typeof artifacts.$inferSelect,
  options?: { readonly verifyBytesUpTo: number },
): Promise<Response> {
  const storageKey = validateArtifactStorageKey(artifact.storageKey, artifact.reviewId);
  const env = serverEnv();
  if (options) {
    const range = parseArtifactRange(request.headers.get("range"), artifact.sizeBytes);
    if (env.ARTIFACT_DRIVER === "s3") {
      if (!env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
        throw new ArtifactStorageError("S3 artifact credentials are unavailable.");
      }
      const upstream = await fetchS3Artifact({
        config: {
          endpoint: env.S3_ENDPOINT,
          region: env.S3_REGION,
          bucket: env.S3_BUCKET,
          accessKeyId: env.S3_ACCESS_KEY_ID,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY,
          forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
        },
        storageKey,
        range: undefined,
      });
      if (upstream.status === 404) {
        await discard(upstream);
        throw new ArtifactNotFoundError("Artifact object is unavailable.");
      }
      if (upstream.status !== 200 || !upstream.body) {
        await discard(upstream);
        throw new ArtifactStorageError("S3 returned an invalid artifact response.");
      }
      const bytes = await readVerifiedArtifactBytes(
        upstream.body,
        artifact.sizeBytes,
        artifact.sha256,
        options.verifyBytesUpTo,
      );
      return verifiedResponse({ bytes, artifact, storageKey, range });
    }
    const local = await openLocalArtifact({
      artifactRoot: env.ARTIFACT_ROOT,
      workspaceRoot,
      storageKey,
      expectedSize: artifact.sizeBytes,
      rangeHeader: null,
    });
    const bytes = await readVerifiedArtifactBytes(
      local.body,
      artifact.sizeBytes,
      artifact.sha256,
      options.verifyBytesUpTo,
    );
    return verifiedResponse({ bytes, artifact, storageKey, range });
  }
  if (env.ARTIFACT_DRIVER === "s3") {
    return s3Response({ artifact, storageKey, rangeHeader: request.headers.get("range") });
  }
  const local = await openLocalArtifact({
    artifactRoot: env.ARTIFACT_ROOT,
    workspaceRoot,
    storageKey,
    expectedSize: artifact.sizeBytes,
    rangeHeader: request.headers.get("range"),
  });
  return new Response(local.body, {
    status: local.range ? 206 : 200,
    headers: artifactResponseHeaders({
      fileName: storageKey.fileName,
      mediaType: artifact.mediaType,
      sha256: artifact.sha256,
      size: local.size,
      range: local.range,
    }),
  });
}

export function artifactStreamErrorResponse(error: unknown): Response {
  if (error instanceof ArtifactRangeError) {
    return emptyArtifactResponse(416, rangeNotSatisfiableHeaders(error.size));
  }
  if (error instanceof ArtifactNotFoundError) return emptyArtifactResponse(404);
  return emptyArtifactResponse(502);
}
