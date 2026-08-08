import { and, desc, eq, ne } from "drizzle-orm";

import {
  applyInfrastructurePolicy,
  infrastructureProposalSchema,
  type InfrastructurePolicyDecision,
  type PolicyApprovedRecipe,
} from "@trialrun/domain";

import type { TrialRunDatabase } from "./client";
import { repositories, repositoryRecipes, type RepositoryRecipe } from "./schema";

export interface ProposeRepositoryRecipeInput {
  readonly repositoryId: string;
  readonly sourceSha: string;
  readonly proposal: unknown;
  readonly proposedByUserId?: string;
  readonly analysisJobId?: string;
}

export interface ProposedRepositoryRecipe {
  readonly record: RepositoryRecipe;
  readonly decision: InfrastructurePolicyDecision;
}

export async function proposeRepositoryRecipe(
  db: TrialRunDatabase,
  input: ProposeRepositoryRecipeInput,
): Promise<ProposedRepositoryRecipe> {
  const proposal = infrastructureProposalSchema.parse(input.proposal);
  if (proposal.sourceSha !== input.sourceSha) {
    throw new Error("The proposal source SHA does not match the repository evidence SHA.");
  }
  const decision = applyInfrastructurePolicy(proposal);

  return db.transaction(async (tx) => {
    if (input.analysisJobId) {
      const [existing] = await tx
        .select()
        .from(repositoryRecipes)
        .where(eq(repositoryRecipes.analysisJobId, input.analysisJobId))
        .limit(1);
      if (existing) return { record: existing, decision: existing.policyDecision };
    }
    const [repository] = await tx
      .select({ id: repositories.id })
      .from(repositories)
      .where(eq(repositories.id, input.repositoryId))
      .limit(1)
      .for("update");
    if (!repository) throw new Error("Repository does not exist or is not available.");

    const [latest] = await tx
      .select({ version: repositoryRecipes.version })
      .from(repositoryRecipes)
      .where(eq(repositoryRecipes.repositoryId, repository.id))
      .orderBy(desc(repositoryRecipes.version))
      .limit(1);
    const [record] = await tx
      .insert(repositoryRecipes)
      .values({
        repositoryId: repository.id,
        version: (latest?.version ?? 0) + 1,
        status: decision.accepted ? "proposed" : "rejected",
        sourceSha: proposal.sourceSha,
        proposal,
        policyDecision: decision,
        approvedRecipe: decision.accepted ? decision.recipe : null,
        fingerprint: decision.accepted ? decision.recipe.fingerprint : null,
        proposedByUserId: input.proposedByUserId ?? null,
        analysisJobId: input.analysisJobId ?? null,
      })
      .returning();
    if (!record) throw new Error("Recipe proposal was not persisted.");
    return { record, decision };
  });
}

export async function confirmRepositoryRecipe(
  db: TrialRunDatabase,
  input: { readonly recipeId: string; readonly confirmedByUserId: string },
): Promise<RepositoryRecipe> {
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select()
      .from(repositoryRecipes)
      .where(eq(repositoryRecipes.id, input.recipeId))
      .limit(1)
      .for("update");
    if (!candidate) throw new Error("Recipe proposal does not exist.");
    if (candidate.status === "confirmed") return candidate;
    if (candidate.status !== "proposed" || !candidate.policyDecision.accepted || !candidate.approvedRecipe) {
      throw new Error("Only a policy-approved proposal can be confirmed.");
    }

    await tx
      .update(repositoryRecipes)
      .set({ status: "superseded" })
      .where(
        and(
          eq(repositoryRecipes.repositoryId, candidate.repositoryId),
          eq(repositoryRecipes.status, "confirmed"),
          ne(repositoryRecipes.id, candidate.id),
        ),
      );
    const [confirmed] = await tx
      .update(repositoryRecipes)
      .set({
        status: "confirmed",
        confirmedByUserId: input.confirmedByUserId,
        confirmedAt: new Date(),
      })
      .where(and(eq(repositoryRecipes.id, candidate.id), eq(repositoryRecipes.status, "proposed")))
      .returning();
    if (!confirmed) throw new Error("Recipe confirmation lost a concurrent update.");
    return confirmed;
  });
}

export async function getConfirmedRepositoryRecipe(
  db: TrialRunDatabase,
  repositoryId: string,
): Promise<{ readonly record: RepositoryRecipe; readonly recipe: PolicyApprovedRecipe } | null> {
  const [record] = await db
    .select()
    .from(repositoryRecipes)
    .where(
      and(
        eq(repositoryRecipes.repositoryId, repositoryId),
        eq(repositoryRecipes.status, "confirmed"),
      ),
    )
    .orderBy(desc(repositoryRecipes.version))
    .limit(1);
  if (!record?.approvedRecipe) return null;
  return { record, recipe: record.approvedRecipe };
}
