import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { artifacts, reviews } from "@trialrun/db";

import { currentAuth } from "@/lib/auth";
import { database } from "@/lib/db";
import {
  artifactStreamErrorResponse,
  emptyArtifactResponse,
  streamStoredArtifact,
} from "../stream";

export const runtime = "nodejs";

const artifactIdSchema = z.uuid();

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ artifactId: string }> },
): Promise<Response> {
  try {
    const auth = await currentAuth();
    if (!auth) return emptyArtifactResponse(401);
    const parsedArtifactId = artifactIdSchema.safeParse((await context.params).artifactId);
    if (!parsedArtifactId.success) return emptyArtifactResponse(404);
    const [owned] = await database()
      .select({ artifact: artifacts })
      .from(artifacts)
      .innerJoin(reviews, eq(artifacts.reviewId, reviews.id))
      .where(and(eq(artifacts.id, parsedArtifactId.data), eq(reviews.ownerUserId, auth.user.id)))
      .limit(1);
    if (!owned) return emptyArtifactResponse(404);
    return await streamStoredArtifact(request, owned.artifact);
  } catch (error) {
    return artifactStreamErrorResponse(error);
  }
}
