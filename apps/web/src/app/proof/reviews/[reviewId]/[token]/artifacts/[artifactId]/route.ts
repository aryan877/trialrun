import { and, eq, inArray, or } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { artifacts } from "@trialrun/db";

import {
  artifactStreamErrorResponse,
  emptyArtifactResponse,
  streamStoredArtifact,
} from "@/app/api/artifacts/stream";
import { database } from "@/lib/db";
import { loadPublicProofReview } from "@/lib/public-proof";

export const runtime = "nodejs";

const artifactIdSchema = z.uuid();
const maximumPublicProofArtifactBytes = 16 * 1_024 * 1_024;

export async function GET(
  request: NextRequest,
  context: {
    params: Promise<{ reviewId: string; token: string; artifactId: string }>;
  },
): Promise<Response> {
  try {
    const params = await context.params;
    const review = await loadPublicProofReview(params);
    const artifactId = artifactIdSchema.safeParse(params.artifactId);
    if (!review || !artifactId.success) return emptyArtifactResponse(404);

    const [artifact] = await database()
      .select()
      .from(artifacts)
      .where(
        and(
          eq(artifacts.id, artifactId.data),
          eq(artifacts.reviewId, review.id),
          inArray(artifacts.side, ["base", "head"]),
          or(
            and(eq(artifacts.kind, "screenshot"), eq(artifacts.mediaType, "image/png")),
            and(eq(artifacts.kind, "browser_recording"), eq(artifacts.mediaType, "video/webm")),
          ),
        ),
      )
      .limit(1);
    if (!artifact) return emptyArtifactResponse(404);
    return await streamStoredArtifact(request, artifact, {
      verifyBytesUpTo: maximumPublicProofArtifactBytes,
    });
  } catch (error) {
    return artifactStreamErrorResponse(error);
  }
}
