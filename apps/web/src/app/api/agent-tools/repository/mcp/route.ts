import { NextRequest, NextResponse } from "next/server";

import { serverEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const maximumRequestBytes = 64 * 1_024;
const maximumResponseBytes = 1 * 1_024 * 1_024;
const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
} as const;

function errorResponse(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status, headers: privateHeaders });
}

function bearerAuthorization(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length);
  return token.length >= 32 && token.length <= 1_024 ? authorization : null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (request.headers.has("origin")) {
    return errorResponse(403, "Browser-originated requests are not accepted.");
  }
  if (request.headers.has("content-encoding")) {
    return errorResponse(415, "Encoded request bodies are not accepted.");
  }
  const authorization = bearerAuthorization(request);
  if (!authorization) return errorResponse(401, "Authentication required.");

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const bytes = Number(declaredLength);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maximumRequestBytes) {
      return errorResponse(413, "Request body is too large.");
    }
  }
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > maximumRequestBytes) {
    return errorResponse(413, "Request body is too large.");
  }

  try {
    const upstream = await fetch(serverEnv().RUNNER_REPOSITORY_MCP_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: authorization,
        "Content-Type": "application/json",
      },
      body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(40_000)]),
    });
    const upstreamLength = upstream.headers.get("content-length");
    if (upstreamLength !== null) {
      const bytes = Number(upstreamLength);
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maximumResponseBytes) {
        return errorResponse(502, "Runner response is too large.");
      }
    }
    const responseBody = new Uint8Array(await upstream.arrayBuffer());
    if (responseBody.byteLength > maximumResponseBytes) {
      return errorResponse(502, "Runner response is too large.");
    }
    return new NextResponse(responseBody, {
      status: upstream.status,
      headers: {
        ...privateHeaders,
        "Content-Type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
      },
    });
  } catch {
    return errorResponse(502, "The repository tool service is unavailable.");
  }
}
