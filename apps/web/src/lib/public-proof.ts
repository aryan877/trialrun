import "server-only";

import { eq } from "drizzle-orm";

import { reviews, type Review } from "@trialrun/db";
import { decodeBase64Key, verifyPublicProofToken } from "@trialrun/domain";

import { database } from "./db";
import { serverEnv } from "./env";
import { isPublicProofReview, publicProofRouteSchema } from "./public-proof-contract";

function validPublicProofToken(reviewId: string, token: string): boolean {
  const configured = serverEnv().VAULT_KEY_BASE64;
  if (!configured) return false;
  try {
    return verifyPublicProofToken(reviewId, token, decodeBase64Key(configured, "VAULT_KEY_BASE64"));
  } catch {
    return false;
  }
}

export async function loadPublicProofReview(input: {
  readonly reviewId: string;
  readonly token: string;
}): Promise<Review | null> {
  const params = publicProofRouteSchema.safeParse(input);
  if (!params.success || !validPublicProofToken(params.data.reviewId, params.data.token)) {
    return null;
  }
  const [review] = await database()
    .select()
    .from(reviews)
    .where(eq(reviews.id, params.data.reviewId))
    .limit(1);
  return review && isPublicProofReview(review) ? review : null;
}
