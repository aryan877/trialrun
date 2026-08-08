import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { assertCsrf, requireAuth } from "@/lib/auth";
import { githubApp } from "@/lib/github";
import { assertSameOrigin, redirectTo } from "@/lib/http";
import { enqueuePullRequestReview, ownedRepository } from "@/lib/reviews";

export const runtime = "nodejs";

const requestSchema = z.object({
  repositoryId: z.string().uuid(),
  pullNumber: z.coerce.number().int().positive().max(1_000_000),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
    const auth = await requireAuth();
    const form = await request.formData();
    assertCsrf(auth, form.get("csrf")?.toString());
    const input = requestSchema.parse({
      repositoryId: form.get("repositoryId"),
      pullNumber: form.get("pullNumber"),
    });
    const source = await ownedRepository(auth.user.id, input.repositoryId);
    if (!source) throw new Error("Repository is unavailable.");
    const pullRequest = await githubApp().resolvePullRequest({
      installationId: source.installation.githubInstallationId,
      owner: source.repository.owner,
      repository: source.repository.name,
      pullNumber: input.pullNumber,
    });
    if (pullRequest.state !== "open" || pullRequest.draft) {
      throw new Error("Choose an open, review-ready pull request.");
    }
    const { review } = await enqueuePullRequestReview({
      source,
      pullNumber: pullRequest.number,
      title: pullRequest.title,
      baseSha: pullRequest.baseSha,
      headSha: pullRequest.headSha,
    });
    return NextResponse.redirect(redirectTo(request, `/app/reviews/${review.id}`), 303);
  } catch {
    return NextResponse.redirect(redirectTo(request, "/app?error=review"), 303);
  }
}
