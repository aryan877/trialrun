import { z } from "zod";

const csrfTokenSchema = z.string().min(20).max(256);

export const workspaceConnectionActionSchema = z.discriminatedUnion("intent", [
  z.strictObject({ intent: z.literal("connect"), csrfToken: csrfTokenSchema }),
  z.strictObject({ intent: z.literal("verify"), csrfToken: csrfTokenSchema }),
  z.strictObject({ intent: z.literal("retry"), csrfToken: csrfTokenSchema }),
  z.strictObject({ intent: z.literal("revoke"), csrfToken: csrfTokenSchema }),
]);

export const workspaceLifecycleStatusSchema = z.enum([
  "not_configured",
  "pending",
  "provisioning",
  "awaiting_auth",
  "connected",
  "reauth_required",
  "revoking",
  "revoked",
  "failed",
]);

export const workspaceOperationSchema = z
  .enum(["provision", "authenticate", "verify", "delete"])
  .nullable();

export const workspaceVerificationSchema = z.strictObject({
  verificationUri: z.literal("https://auth.openai.com/codex/device"),
  userCode: z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4,8}$/),
  expiresAt: z.string().datetime(),
});

export const workspaceConnectionMetadataSchema = z.strictObject({
  provider: z.literal("openai"),
  mode: z.literal("codex_workspace"),
  configured: z.boolean(),
  status: workspaceLifecycleStatusSchema,
  operation: workspaceOperationSchema,
  updatedAt: z.string().datetime().nullable(),
  lastVerifiedAt: z.string().datetime().nullable(),
  verification: workspaceVerificationSchema.nullable(),
});

export const workspaceConnectionApiResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), workspace: workspaceConnectionMetadataSchema }),
  z.strictObject({ ok: z.literal(false), error: z.string().min(1).max(240) }),
]);

export type WorkspaceConnectionAction = z.infer<typeof workspaceConnectionActionSchema>;
export type WorkspaceConnectionMetadata = z.infer<typeof workspaceConnectionMetadataSchema>;
export type WorkspaceConnectionApiResponse = z.infer<typeof workspaceConnectionApiResponseSchema>;
export type WorkspaceOperation = z.infer<typeof workspaceOperationSchema>;

export function emptyWorkspaceConnectionMetadata(): WorkspaceConnectionMetadata {
  return {
    provider: "openai",
    mode: "codex_workspace",
    configured: false,
    status: "not_configured",
    operation: null,
    updatedAt: null,
    lastVerifiedAt: null,
    verification: null,
  };
}
