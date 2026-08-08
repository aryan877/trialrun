import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAuth } from "@/lib/auth";
import { githubApp } from "@/lib/github";
import { verifyGitHubState } from "@/lib/github-state";
import { syncAuthorizedInstallation } from "@/lib/github-sync";
import { redirectTo } from "@/lib/http";

export const runtime = "nodejs";

const callbackSchema = z.object({
  code: z.string().min(10).max(1_000),
  state: z.string().min(20).max(4_000),
  installationId: z.coerce.number().int().positive().safe(),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await requireAuth();
    const callback = callbackSchema.parse({
      code: request.nextUrl.searchParams.get("code"),
      state: request.nextUrl.searchParams.get("state"),
      installationId: request.nextUrl.searchParams.get("installation_id"),
    });
    verifyGitHubState(auth, callback.state);
    const github = githubApp();
    const authorization = await github.authorizeInstallation({
      code: callback.code,
      state: callback.state,
      installationId: callback.installationId,
    });
    const remoteRepositories = await github.listInstallationRepositories(
      authorization.installation.id,
    );
    await syncAuthorizedInstallation({
      userId: auth.user.id,
      authorization,
      remoteRepositories,
    });
    return NextResponse.redirect(redirectTo(request, "/app?github=connected"), 303);
  } catch {
    return NextResponse.redirect(redirectTo(request, "/app?github=failed"), 303);
  }
}
