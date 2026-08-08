import "server-only";

import type { NextRequest } from "next/server";

import { serverEnv } from "./env";

export function assertSameOrigin(request: NextRequest): void {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(serverEnv().APP_URL).origin) {
    throw new Error("Request origin is not allowed.");
  }
}

export function redirectTo(request: NextRequest, path: string): URL {
  return new URL(path, request.url);
}
