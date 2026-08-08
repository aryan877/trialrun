import { NextRequest, NextResponse } from "next/server";

import { assertCsrf, logoutAccount, requireAuth } from "@/lib/auth";
import { assertSameOrigin, redirectTo } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
    const auth = await requireAuth();
    const form = await request.formData();
    assertCsrf(auth, form.get("csrf")?.toString());
    await logoutAccount(auth);
    return NextResponse.redirect(redirectTo(request, "/"), 303);
  } catch {
    return NextResponse.redirect(redirectTo(request, "/app?error=logout"), 303);
  }
}
