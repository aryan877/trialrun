import "server-only";

import { and, eq, notInArray, or } from "drizzle-orm";

import {
  githubAccounts,
  githubInstallations,
  repositories,
} from "@trialrun/db";
import type { AuthorizedInstallation, GitHubRepository } from "@trialrun/github";

import { database } from "./db";

export async function syncAuthorizedInstallation(input: {
  readonly userId: string;
  readonly authorization: AuthorizedInstallation;
  readonly remoteRepositories: readonly GitHubRepository[];
}): Promise<void> {
  await database().transaction(async (tx) => {
    const [existingAccount] = await tx
      .select()
      .from(githubAccounts)
      .where(
        or(
          eq(githubAccounts.userId, input.userId),
          eq(githubAccounts.githubUserId, input.authorization.githubUser.id),
        ),
      )
      .limit(1)
      .for("update");
    if (
      existingAccount &&
      (existingAccount.userId !== input.userId ||
        existingAccount.githubUserId !== input.authorization.githubUser.id)
    ) {
      throw new Error("This GitHub identity is already linked to another TrialRun account.");
    }
    await tx
      .insert(githubAccounts)
      .values({
        userId: input.userId,
        githubUserId: input.authorization.githubUser.id,
        login: input.authorization.githubUser.login,
        avatarUrl: input.authorization.githubUser.avatarUrl,
      })
      .onConflictDoUpdate({
        target: githubAccounts.userId,
        set: {
          login: input.authorization.githubUser.login,
          avatarUrl: input.authorization.githubUser.avatarUrl,
          updatedAt: new Date(),
        },
      });

    const [existingInstallation] = await tx
      .select()
      .from(githubInstallations)
      .where(
        eq(
          githubInstallations.githubInstallationId,
          input.authorization.installation.id,
        ),
      )
      .limit(1)
      .for("update");
    if (existingInstallation && existingInstallation.ownerUserId !== input.userId) {
      throw new Error("This GitHub installation is already linked to another TrialRun account.");
    }
    const [installation] = await tx
      .insert(githubInstallations)
      .values({
        ownerUserId: input.userId,
        githubInstallationId: input.authorization.installation.id,
        accountId: input.authorization.installation.accountId,
        accountLogin: input.authorization.installation.accountLogin,
        accountType: input.authorization.installation.accountType,
        repositorySelection: input.authorization.installation.repositorySelection,
        suspendedAt: input.authorization.installation.suspendedAt
          ? new Date(input.authorization.installation.suspendedAt)
          : null,
      })
      .onConflictDoUpdate({
        target: githubInstallations.githubInstallationId,
        set: {
          accountLogin: input.authorization.installation.accountLogin,
          accountType: input.authorization.installation.accountType,
          repositorySelection: input.authorization.installation.repositorySelection,
          suspendedAt: input.authorization.installation.suspendedAt
            ? new Date(input.authorization.installation.suspendedAt)
            : null,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!installation) throw new Error("GitHub installation was not persisted.");

    for (const remote of input.remoteRepositories) {
      const [existingRepository] = await tx
        .select({ repository: repositories, ownerUserId: githubInstallations.ownerUserId })
        .from(repositories)
        .innerJoin(githubInstallations, eq(repositories.installationId, githubInstallations.id))
        .where(eq(repositories.githubRepositoryId, remote.id))
        .limit(1);
      if (existingRepository && existingRepository.ownerUserId !== input.userId) {
        throw new Error(`Repository ${remote.full_name} is linked to another TrialRun account.`);
      }
      await tx
        .insert(repositories)
        .values({
          installationId: installation.id,
          githubRepositoryId: remote.id,
          owner: remote.owner.login,
          name: remote.name,
          defaultBranch: remote.default_branch,
          isPrivate: remote.private,
          isActive: true,
        })
        .onConflictDoUpdate({
          target: repositories.githubRepositoryId,
          set: {
            installationId: installation.id,
            owner: remote.owner.login,
            name: remote.name,
            defaultBranch: remote.default_branch,
            isPrivate: remote.private,
            isActive: true,
            updatedAt: new Date(),
          },
        });
    }
    const remoteIds = input.remoteRepositories.map(({ id }) => id);
    if (remoteIds.length === 0) {
      await tx
        .update(repositories)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(repositories.installationId, installation.id));
    } else {
      await tx
        .update(repositories)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          and(
            eq(repositories.installationId, installation.id),
            notInArray(repositories.githubRepositoryId, remoteIds),
          ),
        );
    }
  });
}
