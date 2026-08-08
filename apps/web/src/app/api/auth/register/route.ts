import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { parseRegisterAccountInput, registerAccount } from "@/lib/auth";
import { assertSameOrigin, redirectTo } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
    const form = await request.formData();
    const user = await registerAccount(
      parseRegisterAccountInput({
        displayName: form.get("displayName"),
        email: form.get("email"),
        password: form.get("password"),
      }),
    );
    if (!user) {
      return NextResponse.redirect(
        redirectTo(request, "/login?mode=register&auth=registration_failed"),
        303,
      );
    }
    return NextResponse.redirect(redirectTo(request, "/app"), 303);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.redirect(
        redirectTo(request, "/login?mode=register&auth=registration_failed"),
        303,
      );
    }
    console.error("TrialRun registration request failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.redirect(
      redirectTo(request, "/login?mode=register&auth=server"),
      303,
    );
  }
}
