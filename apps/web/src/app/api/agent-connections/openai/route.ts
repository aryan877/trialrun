import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { agentConnections, users } from "@trialrun/db";
import { decodeBase64Key } from "@trialrun/domain";

import { assertCsrf, currentAuth, type AuthContext } from "@/lib/auth";
import { database } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { assertSameOrigin } from "@/lib/http";

import {
  deleteOpenAiConnectionSchema,
  openAiConnectionMetadata,
  putOpenAiConnectionSchema,
  WorkspaceConnectionManagedSeparatelyError,
  type OpenAiConnectionApiResponse,
  type PutOpenAiConnection,
} from "./contract";
import {
  revokedOpenAiConnectionMaterial,
  storedOpenAiConnectionMaterial,
} from "./connection-material";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const privateNoStoreHeaders = { "Cache-Control": "private, no-store, max-age=0" } as const;

function response(body: OpenAiConnectionApiResponse, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: privateNoStoreHeaders });
}

function errorResponse(error: string, status: number): NextResponse {
  return response({ ok: false, error }, status);
}

async function authenticatedRequest(): Promise<AuthContext | null> {
  return currentAuth();
}

async function existingConnection(userId: string) {
  const [record] = await database()
    .select()
    .from(agentConnections)
    .where(and(eq(agentConnections.userId, userId), eq(agentConnections.provider, "openai")))
    .limit(1);
  return record ?? null;
}

export async function GET(): Promise<NextResponse> {
  try {
    const auth = await authenticatedRequest();
    if (!auth) return errorResponse("Authentication required.", 401);
    const record = await existingConnection(auth.user.id);
    return response({ ok: true, connection: openAiConnectionMetadata(record) });
  } catch (error) {
    if (error instanceof WorkspaceConnectionManagedSeparatelyError) {
      return errorResponse(error.message, 409);
    }
    return errorResponse("Unable to read the OpenAI connection.", 500);
  }
}

async function writeConnection(
  auth: AuthContext,
  input: PutOpenAiConnection,
): Promise<OpenAiConnectionApiResponse> {
  const env = serverEnv();
  const vaultKey =
    input.mode === "api_key"
      ? decodeBase64Key(env.VAULT_KEY_BASE64 ?? "", "VAULT_KEY_BASE64")
      : null;
  const record = await database().transaction(async (tx) => {
    const [owner] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, auth.user.id))
      .limit(1)
      .for("update");
    if (!owner) throw new Error("The authenticated account no longer exists.");

    const [existing] = await tx
      .select()
      .from(agentConnections)
      .where(
        and(eq(agentConnections.userId, auth.user.id), eq(agentConnections.provider, "openai")),
      )
      .limit(1)
      .for("update");
    if (existing?.mode === "codex_workspace") {
      throw new WorkspaceConnectionManagedSeparatelyError(
        "Codex subscription workspace access is managed by a separate connection flow.",
      );
    }

    const connectionId = existing?.id ?? randomUUID();
    const material = storedOpenAiConnectionMaterial({
      connectionId,
      userId: auth.user.id,
      request: input,
      vaultKey,
      keyVersion: env.VAULT_KEY_VERSION,
    });
    if (existing) {
      const [updated] = await tx
        .update(agentConnections)
        .set({ ...material, updatedAt: new Date() })
        .where(
          and(
            eq(agentConnections.id, existing.id),
            eq(agentConnections.userId, auth.user.id),
            eq(agentConnections.provider, "openai"),
          ),
        )
        .returning();
      if (!updated) throw new Error("The OpenAI connection changed concurrently.");
      return updated;
    }

    const [created] = await tx
      .insert(agentConnections)
      .values({
        id: connectionId,
        userId: auth.user.id,
        provider: "openai",
        ...material,
      })
      .returning();
    if (!created) throw new Error("The OpenAI connection was not stored.");
    return created;
  });
  return { ok: true, connection: openAiConnectionMetadata(record) };
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
    const auth = await authenticatedRequest();
    if (!auth) return errorResponse("Authentication required.", 401);
    const payload: unknown = await request.json();
    const input = putOpenAiConnectionSchema.parse(payload);
    assertCsrf(auth, input.csrfToken);
    return response(await writeConnection(auth, input));
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return errorResponse("The connection request is invalid.", 400);
    }
    if (error instanceof WorkspaceConnectionManagedSeparatelyError) {
      return errorResponse(error.message, 409);
    }
    if (error instanceof Error && error.message.includes("CSRF")) {
      return errorResponse("The request could not be verified.", 403);
    }
    if (error instanceof Error && error.message.includes("origin")) {
      return errorResponse("The request origin is not allowed.", 403);
    }
    if (error instanceof Error && error.message.includes("VAULT_KEY_BASE64")) {
      return errorResponse("Encrypted API-key storage is unavailable.", 503);
    }
    return errorResponse("Unable to save the OpenAI connection.", 500);
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
    const auth = await authenticatedRequest();
    if (!auth) return errorResponse("Authentication required.", 401);
    const payload: unknown = await request.json();
    const input = deleteOpenAiConnectionSchema.parse(payload);
    assertCsrf(auth, input.csrfToken);

    const record = await database().transaction(async (tx) => {
      const [owner] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, auth.user.id))
        .limit(1)
        .for("update");
      if (!owner) throw new Error("The authenticated account no longer exists.");
      const [existing] = await tx
        .select()
        .from(agentConnections)
        .where(
          and(eq(agentConnections.userId, auth.user.id), eq(agentConnections.provider, "openai")),
        )
        .limit(1)
        .for("update");
      if (!existing) return null;
      if (existing.mode === "codex_workspace") {
        throw new WorkspaceConnectionManagedSeparatelyError(
          "Codex subscription workspace access is managed by a separate connection flow.",
        );
      }
      const now = new Date();
      const [revoked] = await tx
        .update(agentConnections)
        .set({ ...revokedOpenAiConnectionMaterial(now), updatedAt: now })
        .where(
          and(
            eq(agentConnections.id, existing.id),
            eq(agentConnections.userId, auth.user.id),
            eq(agentConnections.provider, "openai"),
          ),
        )
        .returning();
      if (!revoked) throw new Error("The OpenAI connection changed concurrently.");
      return revoked;
    });
    return response({ ok: true, connection: openAiConnectionMetadata(record) });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return errorResponse("The revocation request is invalid.", 400);
    }
    if (error instanceof WorkspaceConnectionManagedSeparatelyError) {
      return errorResponse(error.message, 409);
    }
    if (error instanceof Error && error.message.includes("CSRF")) {
      return errorResponse("The request could not be verified.", 403);
    }
    if (error instanceof Error && error.message.includes("origin")) {
      return errorResponse("The request origin is not allowed.", 403);
    }
    return errorResponse("Unable to revoke the OpenAI connection.", 500);
  }
}
