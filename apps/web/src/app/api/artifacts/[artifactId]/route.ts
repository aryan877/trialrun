import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { artifacts, reviews } from "@trialrun/db";

import { currentAuth } from "@/lib/auth";
import { database } from "@/lib/db";
import { serverEnv, workspaceRoot } from "@/lib/env";

import {
  ArtifactNotFoundError,
  ArtifactRangeError,
  ArtifactStorageError,
  artifactResponseHeaders,
  fetchS3Artifact,
  openLocalArtifact,
  parseArtifactRange,
  rangeNotSatisfiableHeaders,
  validateArtifactStorageKey,
  type ArtifactByteRange,
  type ValidatedArtifactKey,
} from "../storage";

export const runtime = "nodejs";

const artifactIdSchema = z.uuid();
const privateNoStoreHeaders = { "Cache-Control": "private, no-store, max-age=0" } as const;

function emptyResponse(status: number, headers: HeadersInit = privateNoStoreHeaders): Response {
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

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ artifactId: string }> },
): Promise<Response> {
  try {
    const auth = await currentAuth();
    if (!auth) return emptyResponse(401);
    const parsedArtifactId = artifactIdSchema.safeParse((await context.params).artifactId);
    if (!parsedArtifactId.success) return emptyResponse(404);
    const [owned] = await database()
      .select({ artifact: artifacts })
      .from(artifacts)
      .innerJoin(reviews, eq(artifacts.reviewId, reviews.id))
      .where(and(eq(artifacts.id, parsedArtifactId.data), eq(reviews.ownerUserId, auth.user.id)))
      .limit(1);
    if (!owned) return emptyResponse(404);

    const storageKey = validateArtifactStorageKey(
      owned.artifact.storageKey,
      owned.artifact.reviewId,
    );
    const env = serverEnv();
    if (env.ARTIFACT_DRIVER === "s3") {
      return await s3Response({
        artifact: owned.artifact,
        storageKey,
        rangeHeader: request.headers.get("range"),
      });
    }
    const local = await openLocalArtifact({
      artifactRoot: env.ARTIFACT_ROOT,
      workspaceRoot,
      storageKey,
      expectedSize: owned.artifact.sizeBytes,
      rangeHeader: request.headers.get("range"),
    });
    return new Response(local.body, {
      status: local.range ? 206 : 200,
      headers: artifactResponseHeaders({
        fileName: storageKey.fileName,
        mediaType: owned.artifact.mediaType,
        sha256: owned.artifact.sha256,
        size: local.size,
        range: local.range,
      }),
    });
  } catch (error) {
    if (error instanceof ArtifactRangeError) {
      return emptyResponse(416, rangeNotSatisfiableHeaders(error.size));
    }
    if (error instanceof ArtifactNotFoundError) return emptyResponse(404);
    return emptyResponse(502);
  }
}
