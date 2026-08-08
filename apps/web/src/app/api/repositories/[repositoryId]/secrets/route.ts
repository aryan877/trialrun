import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { repositoryRecipes, repositorySecrets } from "@trialrun/db";
import { decodeBase64Key, encryptSecret } from "@trialrun/domain";

import { assertCsrf, requireAuth } from "@/lib/auth";
import { database } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { assertSameOrigin, redirectTo } from "@/lib/http";
import { ownedRepository } from "@/lib/reviews";

export const runtime = "nodejs";

const secretInputSchema = z.object({
  intent: z.enum(["set", "delete"]),
  name: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/),
  value: z.string().min(1).max(4_096).optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ repositoryId: string }> },
): Promise<NextResponse> {
  const repositoryId = z.string().uuid().parse((await context.params).repositoryId);
  try {
    assertSameOrigin(request);
    const auth = await requireAuth();
    const form = await request.formData();
    assertCsrf(auth, form.get("csrf")?.toString());
    const input = secretInputSchema.parse({
      intent: form.get("intent"),
      name: form.get("name"),
      value: form.get("value") || undefined,
    });
    if (!(await ownedRepository(auth.user.id, repositoryId))) {
      throw new Error("Repository is unavailable.");
    }
    const [recipe] = await database()
      .select({ approvedRecipe: repositoryRecipes.approvedRecipe })
      .from(repositoryRecipes)
      .where(
        and(
          eq(repositoryRecipes.repositoryId, repositoryId),
          eq(repositoryRecipes.status, "confirmed"),
        ),
      )
      .orderBy(desc(repositoryRecipes.version))
      .limit(1);
    const allowedNames = new Set(
      recipe?.approvedRecipe?.secretBindings.map(({ secretName }) => secretName) ?? [],
    );
    if (!allowedNames.has(input.name)) {
      throw new Error("Only secret names required by the confirmed recipe can be stored.");
    }
    if (input.intent === "delete") {
      await database()
        .delete(repositorySecrets)
        .where(
          and(
            eq(repositorySecrets.repositoryId, repositoryId),
            eq(repositorySecrets.name, input.name),
          ),
        );
    } else {
      const env = serverEnv();
      const vaultKey = env.VAULT_KEY_BASE64;
      if (!input.value || !vaultKey) {
        throw new Error("The secret value or vault key is unavailable.");
      }
      const encrypted = encryptSecret(
        input.value,
        decodeBase64Key(vaultKey, "VAULT_KEY_BASE64"),
        env.VAULT_KEY_VERSION,
        `trialrun:repository-secret:${repositoryId}:${input.name}`,
      );
      await database()
        .insert(repositorySecrets)
        .values({ repositoryId, name: input.name, ...encrypted })
        .onConflictDoUpdate({
          target: [repositorySecrets.repositoryId, repositorySecrets.name],
          set: { ...encrypted, updatedAt: new Date() },
        });
    }
    return NextResponse.redirect(redirectTo(request, `/app/repositories/${repositoryId}?secret=updated`), 303);
  } catch {
    return NextResponse.redirect(redirectTo(request, `/app/repositories/${repositoryId}?error=secret`), 303);
  }
}
