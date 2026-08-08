import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { githubInstallations, repositories, repositoryRecipes, confirmRepositoryRecipe } from "@trialrun/db";
import { and, eq } from "drizzle-orm";

import { assertCsrf, requireAuth } from "@/lib/auth";
import { database } from "@/lib/db";
import { assertSameOrigin, redirectTo } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ recipeId: string }> },
): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
    const auth = await requireAuth();
    const form = await request.formData();
    assertCsrf(auth, form.get("csrf")?.toString());
    const recipeId = z.string().uuid().parse((await context.params).recipeId);
    const [owned] = await database()
      .select({ repositoryId: repositories.id })
      .from(repositoryRecipes)
      .innerJoin(repositories, eq(repositoryRecipes.repositoryId, repositories.id))
      .innerJoin(githubInstallations, eq(repositories.installationId, githubInstallations.id))
      .where(
        and(
          eq(repositoryRecipes.id, recipeId),
          eq(githubInstallations.ownerUserId, auth.user.id),
        ),
      )
      .limit(1);
    if (!owned) throw new Error("Recipe is unavailable.");
    await confirmRepositoryRecipe(database(), { recipeId, confirmedByUserId: auth.user.id });
    return NextResponse.redirect(redirectTo(request, `/app/repositories/${owned.repositoryId}?recipe=confirmed`), 303);
  } catch {
    return NextResponse.redirect(redirectTo(request, "/app?error=confirmation"), 303);
  }
}
