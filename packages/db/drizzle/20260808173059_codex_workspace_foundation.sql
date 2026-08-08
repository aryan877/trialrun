CREATE TYPE "public"."agent_connection_job_kind" AS ENUM('provision', 'authenticate', 'verify', 'delete');--> statement-breakpoint
ALTER TYPE "public"."agent_connection_status" ADD VALUE 'provisioning' BEFORE 'connected';--> statement-breakpoint
ALTER TYPE "public"."agent_connection_status" ADD VALUE 'awaiting_auth' BEFORE 'connected';--> statement-breakpoint
ALTER TYPE "public"."agent_connection_status" ADD VALUE 'reauth_required' BEFORE 'revoked';--> statement-breakpoint
ALTER TYPE "public"."agent_connection_status" ADD VALUE 'revoking' BEFORE 'revoked';--> statement-breakpoint
CREATE TABLE "agent_connection_auth_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"key_version" integer NOT NULL,
	"iv" text NOT NULL,
	"ciphertext" text NOT NULL,
	"auth_tag" text NOT NULL,
	"verification_uri" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_connection_auth_challenges_key_version_positive" CHECK ("agent_connection_auth_challenges"."key_version" > 0),
	CONSTRAINT "agent_connection_auth_challenges_ciphertext_complete" CHECK (length("agent_connection_auth_challenges"."iv") > 0 and length("agent_connection_auth_challenges"."ciphertext") > 0 and length("agent_connection_auth_challenges"."auth_tag") > 0),
	CONSTRAINT "agent_connection_auth_challenges_verification_uri_safe" CHECK ("agent_connection_auth_challenges"."verification_uri" ~ '^https://[^?#]+$'),
	CONSTRAINT "agent_connection_auth_challenges_expiry_after_creation" CHECK ("agent_connection_auth_challenges"."expires_at" > "agent_connection_auth_challenges"."created_at")
);
--> statement-breakpoint
CREATE TABLE "agent_connection_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"kind" "agent_connection_job_kind" NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"locked_by" varchar(160),
	"last_error_code" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_connection_jobs_attempts_nonnegative" CHECK ("agent_connection_jobs"."attempts" >= 0),
	CONSTRAINT "agent_connection_jobs_attempts_within_max" CHECK ("agent_connection_jobs"."attempts" <= "agent_connection_jobs"."max_attempts"),
	CONSTRAINT "agent_connection_jobs_max_attempts_bounded" CHECK ("agent_connection_jobs"."max_attempts" between 1 and 20),
	CONSTRAINT "agent_connection_jobs_lease_material" CHECK (("agent_connection_jobs"."status" = 'running' and "agent_connection_jobs"."locked_by" is not null and "agent_connection_jobs"."lease_expires_at" is not null)
        or ("agent_connection_jobs"."status" <> 'running' and "agent_connection_jobs"."locked_by" is null and "agent_connection_jobs"."lease_expires_at" is null)),
	CONSTRAINT "agent_connection_jobs_error_code_format" CHECK ("agent_connection_jobs"."last_error_code" is null or "agent_connection_jobs"."last_error_code" ~ '^[a-z0-9][a-z0-9._-]{0,79}$')
);
--> statement-breakpoint
ALTER TABLE "agent_connections" DROP CONSTRAINT "agent_connections_mode_material";--> statement-breakpoint
ALTER TABLE "agent_connections" DROP CONSTRAINT "agent_connections_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_connections" ADD COLUMN "workspace_ownership_token_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "agent_connections" ADD COLUMN "workspace_bridge_url" text;--> statement-breakpoint
ALTER TABLE "agent_connections" ADD COLUMN "last_error_code" varchar(80);--> statement-breakpoint
ALTER TABLE "agent_connections" ADD COLUMN "deletion_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_connections" ADD COLUMN "deletion_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_connections" ADD COLUMN "deletion_proof" jsonb;--> statement-breakpoint
UPDATE "agent_connections"
SET
	"key_version" = NULL,
	"iv" = NULL,
	"ciphertext" = NULL,
	"auth_tag" = NULL,
	"zcp_project_id" = NULL,
	"zcp_service_id" = NULL
WHERE "mode" = 'managed';--> statement-breakpoint
UPDATE "agent_connections"
SET
	"zcp_project_id" = NULL,
	"zcp_service_id" = NULL
WHERE "mode" = 'api_key';--> statement-breakpoint
UPDATE "agent_connections"
SET
	"key_version" = NULL,
	"iv" = NULL,
	"ciphertext" = NULL,
	"auth_tag" = NULL
WHERE "mode" = 'codex_workspace';--> statement-breakpoint
ALTER TABLE "agent_connection_auth_challenges" ADD CONSTRAINT "agent_auth_challenges_connection_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."agent_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_connection_jobs" ADD CONSTRAINT "agent_connection_jobs_connection_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."agent_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_connection_auth_challenges_connection_unique" ON "agent_connection_auth_challenges" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "agent_connection_auth_challenges_expiry_idx" ON "agent_connection_auth_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "agent_connection_jobs_claim_idx" ON "agent_connection_jobs" USING btree ("status","available_at","created_at");--> statement-breakpoint
CREATE INDEX "agent_connection_jobs_connection_idx" ON "agent_connection_jobs" USING btree ("connection_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_connection_jobs_one_active_unique" ON "agent_connection_jobs" USING btree ("connection_id") WHERE "agent_connection_jobs"."status" in ('queued', 'running');--> statement-breakpoint
ALTER TABLE "agent_connections" ADD CONSTRAINT "agent_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_connections" ADD CONSTRAINT "agent_connections_workspace_material_order" CHECK (("agent_connections"."zcp_service_id" is null or "agent_connections"."zcp_project_id" is not null)
        and ("agent_connections"."workspace_bridge_url" is null or "agent_connections"."zcp_service_id" is not null)
        and ("agent_connections"."deletion_completed_at" is null or ("agent_connections"."deletion_started_at" is not null and "agent_connections"."deletion_proof" is not null))
        and ("agent_connections"."deletion_proof" is null or "agent_connections"."deletion_completed_at" is not null));--> statement-breakpoint
ALTER TABLE "agent_connections" ADD CONSTRAINT "agent_connections_ownership_hash_format" CHECK ("agent_connections"."workspace_ownership_token_hash" is null or "agent_connections"."workspace_ownership_token_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "agent_connections" ADD CONSTRAINT "agent_connections_error_code_format" CHECK ("agent_connections"."last_error_code" is null or "agent_connections"."last_error_code" ~ '^[a-z0-9][a-z0-9._-]{0,79}$');--> statement-breakpoint
ALTER TABLE "agent_connections" ADD CONSTRAINT "agent_connections_mode_material" CHECK (("agent_connections"."mode" = 'managed'
          and "agent_connections"."key_version" is null
          and "agent_connections"."iv" is null
          and "agent_connections"."ciphertext" is null
          and "agent_connections"."auth_tag" is null
          and "agent_connections"."zcp_project_id" is null
          and "agent_connections"."zcp_service_id" is null
          and "agent_connections"."workspace_ownership_token_hash" is null
          and "agent_connections"."workspace_bridge_url" is null
          and "agent_connections"."deletion_started_at" is null
          and "agent_connections"."deletion_completed_at" is null
          and "agent_connections"."deletion_proof" is null)
        or ("agent_connections"."mode" = 'api_key'
          and "agent_connections"."key_version" is not null
          and "agent_connections"."iv" is not null
          and "agent_connections"."ciphertext" is not null
          and "agent_connections"."auth_tag" is not null
          and "agent_connections"."zcp_project_id" is null
          and "agent_connections"."zcp_service_id" is null
          and "agent_connections"."workspace_ownership_token_hash" is null
          and "agent_connections"."workspace_bridge_url" is null
          and "agent_connections"."deletion_started_at" is null
          and "agent_connections"."deletion_completed_at" is null
          and "agent_connections"."deletion_proof" is null)
        or ("agent_connections"."mode" = 'codex_workspace'
          and "agent_connections"."key_version" is null
          and "agent_connections"."iv" is null
          and "agent_connections"."ciphertext" is null
          and "agent_connections"."auth_tag" is null));
