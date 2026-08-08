import { NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth";
import { githubApp } from "@/lib/github";
import { createGitHubState } from "@/lib/github-state";
import { redirectTo } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await requireAuth();
    const url = await githubApp().installationUrl(createGitHubState(auth));
    return NextResponse.redirect(url, 302);
  } catch {
    return NextResponse.redirect(redirectTo(request, "/app?github=unavailable"), 302);
  }
}
