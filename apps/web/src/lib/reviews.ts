import "server-only";

import { and, desc, eq, isNull, notInArray } from "drizzle-orm";

import {
  agentConnections,
  githubInstallations,
  jobs,
  repositories,
  repositoryRecipes,
  reviews,
  type Review,
} from "@trialrun/db";

import { database } from "./db";
import { serverEnv } from "./env";
import { githubApp } from "./github";

export interface ConnectedRepository {
  readonly repository: typeof repositories.$inferSelect;
  readonly installation: typeof githubInstallations.$inferSelect;
}

export async function ownedRepository(
  userId: string,
  repositoryId: string,
): Promise<ConnectedRepository | null> {
  const [source] = await database()
    .select({ repository: repositories, installation: githubInstallations })
    .from(repositories)
    .innerJoin(githubInstallations, eq(repositories.installationId, githubInstallations.id))
    .where(
      and(
        eq(repositories.id, repositoryId),
        eq(githubInstallations.ownerUserId, userId),
        eq(repositories.isActive, true),
      ),
    )
    .limit(1);
  return source ?? null;
}

export async function connectedRepositoryByGitHubIds(
  installationId: number,
  repositoryId: number,
): Promise<ConnectedRepository | null> {
  const [source] = await database()
    .select({ repository: repositories, installation: githubInstallations })
    .from(repositories)
    .innerJoin(githubInstallations, eq(repositories.installationId, githubInstallations.id))
    .where(
      and(
        eq(githubInstallations.githubInstallationId, installationId),
        eq(repositories.githubRepositoryId, repositoryId),
        eq(repositories.isActive, true),
      ),
    )
    .limit(1);
  return source ?? null;
}

export async function enqueuePullRequestReview(input: {
  readonly source: ConnectedRepository;
  readonly pullNumber: number;
  readonly title: string;
  readonly baseSha: string;
  readonly headSha: string;
}): Promise<{ readonly review: Review; readonly created: boolean }> {
  const result = await database().transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(reviews)
      .where(
        and(
          eq(reviews.repositoryId, input.source.repository.id),
          eq(reviews.pullNumber, input.pullNumber),
          eq(reviews.headSha, input.headSha),
          notInArray(reviews.status, ["completed", "inconclusive", "cancelled"]),
        ),
      )
      .limit(1);
    if (existing) return { review: existing, created: false } as const;
    const [recipe] = await tx
      .select()
      .from(repositoryRecipes)
      .where(
        and(
          eq(repositoryRecipes.repositoryId, input.source.repository.id),
          eq(repositoryRecipes.status, "confirmed"),
        ),
      )
      .orderBy(desc(repositoryRecipes.version))
      .limit(1);
    if (!recipe?.approvedRecipe) {
      throw new Error("Confirm the repository infrastructure recipe before running a PR.");
    }
    const [agentConnection] = await tx
      .select({ id: agentConnections.id })
      .from(agentConnections)
      .where(
        and(
          eq(agentConnections.userId, input.source.installation.ownerUserId),
          eq(agentConnections.provider, "openai"),
          eq(agentConnections.status, "connected"),
        ),
      )
      .limit(1);
    if (!agentConnection) {
      throw new Error("Choose a connected Codex option before running a pull request review.");
    }
    const [review] = await tx
      .insert(reviews)
      .values({
        ownerUserId: input.source.installation.ownerUserId,
        repositoryId: input.source.repository.id,
        recipeId: recipe.id,
        pullNumber: input.pullNumber,
        title: input.title.slice(0, 240),
        baseSha: input.baseSha,
        headSha: input.headSha,
        provider: serverEnv().EXECUTION_PROVIDER,
        agentConnectionId: agentConnection.id,
      })
      .returning();
    if (!review) throw new Error("Pull request review was not persisted.");
    await tx.insert(jobs).values({ reviewId: review.id, kind: "run_review" });
    return { review, created: true } as const;
  });

  if (result.created && !result.review.checkRunId) {
    const checkRunId = await githubApp().createQueuedCheck(
      input.source.installation.githubInstallationId,
      {
        owner: input.source.repository.owner,
        repository: input.source.repository.name,
        headSha: input.headSha,
        detailsUrl: new URL(`/app/reviews/${result.review.id}`, serverEnv().APP_URL).href,
        title: "TrialRun review queued",
        summary: "Exact base and PR commits will be deployed from the confirmed repository recipe.",
      },
    );
    const [updated] = await database()
      .update(reviews)
      .set({ checkRunId })
      .where(and(eq(reviews.id, result.review.id), isNull(reviews.checkRunId)))
      .returning();
    if (updated) return { review: updated, created: result.created };
  }
  return result;
}
