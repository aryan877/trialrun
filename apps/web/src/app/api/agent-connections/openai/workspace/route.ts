import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { assertCsrf, currentAuth } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/http";

import { workspaceConnectionActionSchema, type WorkspaceConnectionApiResponse } from "./contract";
import {
  performWorkspaceAction,
  readWorkspaceConnection,
  WorkspaceLifecycleConflictError,
} from "./service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const privateNoStoreHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
  Vary: "Cookie",
} as const;

function response(body: WorkspaceConnectionApiResponse, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: privateNoStoreHeaders });
}

function errorResponse(error: string, status: number): NextResponse {
  return response({ ok: false, error }, status);
}

export async function GET(): Promise<NextResponse> {
  try {
    const auth = await currentAuth();
    if (!auth) return errorResponse("Authentication required.", 401);
    return response({ ok: true, workspace: await readWorkspaceConnection(auth.user.id) });
  } catch {
    return errorResponse("Unable to read the Codex workspace connection.", 500);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
  } catch {
    return errorResponse("The request origin is not allowed.", 403);
  }

  let auth;
  try {
    auth = await currentAuth();
  } catch {
    return errorResponse("Unable to authenticate the workspace request.", 500);
  }
  if (!auth) return errorResponse("Authentication required.", 401);

  try {
    const payload: unknown = await request.json();
    const action = workspaceConnectionActionSchema.parse(payload);
    try {
      assertCsrf(auth, action.csrfToken);
    } catch {
      return errorResponse("The request could not be verified.", 403);
    }
    return response({ ok: true, workspace: await performWorkspaceAction(auth.user.id, action) });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return errorResponse("The workspace connection request is invalid.", 400);
    }
    if (error instanceof WorkspaceLifecycleConflictError) {
      return errorResponse(error.message, 409);
    }
    return errorResponse("Unable to update the Codex workspace connection.", 500);
  }
}
