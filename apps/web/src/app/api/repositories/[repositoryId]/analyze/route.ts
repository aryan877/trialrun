import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { enqueueRepositoryAnalysis } from "@trialrun/db";

import { connectedOpenAiConnectionId } from "@/lib/agent-connections";
import { assertCsrf, requireAuth } from "@/lib/auth";
import { database } from "@/lib/db";
import { githubApp } from "@/lib/github";
import { assertSameOrigin, redirectTo } from "@/lib/http";
import { ownedRepository } from "@/lib/reviews";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ repositoryId: string }> },
): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
    const auth = await requireAuth();
    const form = await request.formData();
    assertCsrf(auth, form.get("csrf")?.toString());
    const repositoryId = z.string().uuid().parse((await context.params).repositoryId);
    const source = await ownedRepository(auth.user.id, repositoryId);
    if (!source) throw new Error("Repository is unavailable.");
    const sourceSha = await githubApp().resolveBranchSha({
      installationId: source.installation.githubInstallationId,
      owner: source.repository.owner,
      repository: source.repository.name,
      branch: source.repository.defaultBranch,
    });
    await enqueueRepositoryAnalysis(database(), {
      repositoryId,
      requestedByUserId: auth.user.id,
      agentConnectionId: await connectedOpenAiConnectionId(auth.user.id),
      sourceSha,
    });
    return NextResponse.redirect(redirectTo(request, `/app/repositories/${repositoryId}?analysis=queued`), 303);
  } catch {
    return NextResponse.redirect(redirectTo(request, "/app?error=analysis"), 303);
  }
}
