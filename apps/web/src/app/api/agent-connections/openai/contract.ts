import { z } from "zod";

const csrfTokenSchema = z.string().min(20).max(256);

export const putOpenAiConnectionSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("managed"),
    csrfToken: csrfTokenSchema,
  }),
  z.strictObject({
    mode: z.literal("api_key"),
    csrfToken: csrfTokenSchema,
    apiKey: z.string().min(20).max(4_096).regex(/^\S+$/, "The API key cannot contain whitespace."),
  }),
]);

export const deleteOpenAiConnectionSchema = z.strictObject({
  csrfToken: csrfTokenSchema,
});

export const openAiConnectionMetadataSchema = z.strictObject({
  provider: z.literal("openai"),
  configured: z.boolean(),
  mode: z.enum(["managed", "api_key"]).nullable(),
  status: z.enum(["not_configured", "pending", "connected", "revoked", "failed"]),
  updatedAt: z.string().datetime().nullable(),
  lastVerifiedAt: z.string().datetime().nullable(),
});

export const openAiConnectionApiResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), connection: openAiConnectionMetadataSchema }),
  z.strictObject({ ok: z.literal(false), error: z.string().min(1).max(240) }),
]);

export type PutOpenAiConnection = z.infer<typeof putOpenAiConnectionSchema>;
export type OpenAiConnectionMetadata = z.infer<typeof openAiConnectionMetadataSchema>;
export type OpenAiConnectionApiResponse = z.infer<typeof openAiConnectionApiResponseSchema>;

export interface OpenAiConnectionMetadataSource {
  readonly mode: "managed" | "api_key" | "codex_workspace";
  readonly status:
    | "pending"
    | "provisioning"
    | "awaiting_auth"
    | "connected"
    | "reauth_required"
    | "revoking"
    | "revoked"
    | "failed";
  readonly updatedAt: Date;
  readonly lastVerifiedAt: Date | null;
}

export class WorkspaceConnectionManagedSeparatelyError extends Error {}

function publicConnectionStatus(
  status: OpenAiConnectionMetadataSource["status"],
): OpenAiConnectionMetadata["status"] {
  switch (status) {
    case "pending":
    case "provisioning":
    case "awaiting_auth":
      return "pending";
    case "connected":
      return "connected";
    case "revoking":
    case "revoked":
      return "revoked";
    case "reauth_required":
    case "failed":
      return "failed";
  }
}

export function openAiConnectionMetadata(
  source: OpenAiConnectionMetadataSource | null | undefined,
): OpenAiConnectionMetadata {
  if (!source) {
    return {
      provider: "openai",
      configured: false,
      mode: null,
      status: "not_configured",
      updatedAt: null,
      lastVerifiedAt: null,
    };
  }
  if (source.mode === "codex_workspace") {
    throw new WorkspaceConnectionManagedSeparatelyError(
      "Codex subscription workspace access is managed by a separate connection flow.",
    );
  }
  const status = publicConnectionStatus(source.status);
  return openAiConnectionMetadataSchema.parse({
    provider: "openai",
    configured: status !== "revoked",
    mode: status === "revoked" ? null : source.mode,
    status,
    updatedAt: source.updatedAt.toISOString(),
    lastVerifiedAt: source.lastVerifiedAt?.toISOString() ?? null,
  });
}
