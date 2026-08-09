import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";

import {
  claimWebhookDelivery,
  completeWebhookDelivery,
  confirmRepositoryRecipe,
  enqueueRepositoryAnalysis,
  failWebhookDelivery,
  githubInstallations,
  repositories,
  repositoryRecipes,
  requestReviewCancellation,
  reviews,
} from "@trialrun/db";
import {
  installationRepositoriesWebhookSchema,
  installationWebhookSchema,
  issueCommentWebhookSchema,
  parseTrialRunCommand,
  pullRequestWebhookSchema,
  verifyWebhook,
} from "@trialrun/github";

import { database } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { githubApp } from "@/lib/github";
import {
  connectedRepositoryByGitHubIds,
  enqueuePullRequestReview,
} from "@/lib/reviews";
import { connectedOpenAiConnectionId } from "@/lib/agent-connections";

export const runtime = "nodejs";

const permissionRank = { none: 0, read: 1, triage: 2, write: 3, maintain: 4, admin: 5 } as const;

async function handleInstallation(payload: unknown): Promise<void> {
  const event = installationWebhookSchema.parse(payload);
  if (event.action === "created" || event.action === "new_permissions_accepted") return;
  const [installation] = await database()
    .update(githubInstallations)
    .set({
      suspendedAt: event.action === "unsuspend" ? null : new Date(),
      updatedAt: new Date(),
    })
    .where(eq(githubInstallations.githubInstallationId, event.installation.id))
    .returning();
  if (installation && (event.action === "deleted" || event.action === "suspend")) {
    await database()
      .update(repositories)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(repositories.installationId, installation.id));
  }
}

async function handleInstallationRepositories(payload: unknown): Promise<void> {
  const event = installationRepositoriesWebhookSchema.parse(payload);
  const [installation] = await database()
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.githubInstallationId, event.installation.id))
    .limit(1);
  if (!installation) return;
  if (event.action === "removed") {
    const removedIds = event.repositories_removed.map(({ id }) => id);
    if (removedIds.length > 0) {
      await database()
        .update(repositories)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          and(
            eq(repositories.installationId, installation.id),
            inArray(repositories.githubRepositoryId, removedIds),
          ),
        );
    }
    return;
  }
  await database().transaction(async (tx) => {
    for (const remote of event.repositories_added) {
      const [inserted] = await tx
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
        .onConflictDoNothing()
        .returning({ id: repositories.id });
      if (inserted) continue;

      const [existing] = await tx
        .select({ repositoryId: repositories.id, ownerUserId: githubInstallations.ownerUserId })
        .from(repositories)
        .innerJoin(githubInstallations, eq(repositories.installationId, githubInstallations.id))
        .where(eq(repositories.githubRepositoryId, remote.id))
        .limit(1)
        .for("update");
      if (!existing || existing.ownerUserId !== installation.ownerUserId) continue;

      await tx
        .update(repositories)
        .set({
          installationId: installation.id,
          owner: remote.owner.login,
          name: remote.name,
          defaultBranch: remote.default_branch,
          isPrivate: remote.private,
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(repositories.id, existing.repositoryId));
    }
  });
}

async function handlePullRequest(payload: unknown): Promise<void> {
  const event = pullRequestWebhookSchema.parse(payload);
  if (!["opened", "reopened", "synchronize", "ready_for_review"].includes(event.action)) return;
  if (event.pull_request.draft || event.pull_request.state !== "open") return;
  const source = await connectedRepositoryByGitHubIds(event.installation.id, event.repository.id);
  if (!source || !source.repository.config.automaticReviews) return;
  const [confirmed] = await database()
    .select({ id: repositoryRecipes.id })
    .from(repositoryRecipes)
    .where(
      and(
        eq(repositoryRecipes.repositoryId, source.repository.id),
        eq(repositoryRecipes.status, "confirmed"),
      ),
    )
    .limit(1);
  if (!confirmed) return;
  await enqueuePullRequestReview({
    source,
    pullNumber: event.pull_request.number,
    title: event.pull_request.title,
    baseSha: event.pull_request.base.sha,
    headSha: event.pull_request.head.sha,
  });
}

async function handleIssueComment(payload: unknown): Promise<void> {
  const event = issueCommentWebhookSchema.parse(payload);
  const command = parseTrialRunCommand(event.comment.body);
  if (!command || !event.issue.pull_request) return;
  const source = await connectedRepositoryByGitHubIds(event.installation.id, event.repository.id);
  if (!source) return;
  const permission = await githubApp().repositoryPermission(event.installation.id, {
    owner: source.repository.owner,
    repository: source.repository.name,
    username: event.comment.user.login,
  });
  const required = command === "confirm" ? permissionRank.maintain : permissionRank.write;
  if (permissionRank[permission] < required) return;

  if (command === "analyze") {
    const sourceSha = await githubApp().resolveBranchSha({
      installationId: event.installation.id,
      owner: source.repository.owner,
      repository: source.repository.name,
      branch: source.repository.defaultBranch,
    });
    await enqueueRepositoryAnalysis(database(), {
      repositoryId: source.repository.id,
      requestedByUserId: source.installation.ownerUserId,
      agentConnectionId: await connectedOpenAiConnectionId(source.installation.ownerUserId),
      sourceSha,
    });
    return;
  }
  if (command === "confirm") {
    const [recipe] = await database()
      .select({ id: repositoryRecipes.id })
      .from(repositoryRecipes)
      .where(
        and(
          eq(repositoryRecipes.repositoryId, source.repository.id),
          eq(repositoryRecipes.status, "proposed"),
        ),
      )
      .orderBy(desc(repositoryRecipes.version))
      .limit(1);
    if (recipe) {
      await confirmRepositoryRecipe(database(), {
        recipeId: recipe.id,
        confirmedByUserId: source.installation.ownerUserId,
      });
    }
    return;
  }
  if (command === "run") {
    const pullRequest = await githubApp().resolvePullRequest({
      installationId: event.installation.id,
      owner: source.repository.owner,
      repository: source.repository.name,
      pullNumber: event.issue.number,
    });
    if (pullRequest.state === "open" && !pullRequest.draft) {
      await enqueuePullRequestReview({
        source,
        pullNumber: pullRequest.number,
        title: pullRequest.title,
        baseSha: pullRequest.baseSha,
        headSha: pullRequest.headSha,
      });
    }
    return;
  }
  const [latest] = await database()
    .select()
    .from(reviews)
    .where(
      and(
        eq(reviews.repositoryId, source.repository.id),
        eq(reviews.pullNumber, event.issue.number),
      ),
    )
    .orderBy(desc(reviews.createdAt))
    .limit(1);
  if (!latest) return;
  if (command === "cancel") {
    await requestReviewCancellation(
      database(),
      latest.id,
      "Cancellation requested from GitHub",
    );
  }
  if (command === "explain") {
    await githubApp().createPullRequestComment(event.installation.id, {
      owner: source.repository.owner,
      repository: source.repository.name,
      pullNumber: event.issue.number,
      body: latest.verdict
        ? `TrialRun verdict: **${latest.verdict}**. ${latest.statusMessage}`
        : `TrialRun is currently **${latest.status.replaceAll("_", " ")}**. ${latest.statusMessage}`,
    });
  }
}

async function processWebhook(eventName: string, payload: unknown): Promise<void> {
  if (eventName === "installation") return handleInstallation(payload);
  if (eventName === "installation_repositories") return handleInstallationRepositories(payload);
  if (eventName === "pull_request") return handlePullRequest(payload);
  if (eventName === "issue_comment") return handleIssueComment(payload);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const webhookSecret = serverEnv().GITHUB_WEBHOOK_SECRET;
  if (!webhookSecret) return NextResponse.json({ error: "Webhook is not configured." }, { status: 503 });
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > 2_000_000) {
    return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  }
  let headers: { readonly deliveryId: string; readonly eventName: string };
  try {
    headers = verifyWebhook({
      rawBody,
      secret: webhookSecret,
      signature: request.headers.get("x-hub-signature-256") ?? "",
      deliveryId: request.headers.get("x-github-delivery") ?? "",
      eventName: request.headers.get("x-github-event") ?? "",
    });
  } catch {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }
  const claim = await claimWebhookDelivery(database(), {
    deliveryId: headers.deliveryId,
    eventName: headers.eventName,
    claimantId: randomUUID(),
  });
  if (!claim) return NextResponse.json({ accepted: true }, { status: 202 });
  try {
    const payload: unknown = JSON.parse(rawBody);
    await processWebhook(headers.eventName, payload);
    await completeWebhookDelivery(database(), claim);
    return NextResponse.json({ accepted: true }, { status: 202 });
  } catch (error) {
    await failWebhookDelivery(
      database(),
      claim,
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
