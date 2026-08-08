CREATE TYPE "public"."agent_connection_mode" AS ENUM('managed', 'api_key', 'codex_workspace');--> statement-breakpoint
CREATE TYPE "public"."agent_connection_status" AS ENUM('pending', 'connected', 'revoked', 'failed');--> statement-breakpoint
CREATE TYPE "public"."artifact_side" AS ENUM('base', 'head', 'review');--> statement-breakpoint
CREATE TYPE "public"."execution_provider" AS ENUM('local', 'zerops');--> statement-breakpoint
CREATE TYPE "public"."finding_severity" AS ENUM('blocking', 'warning');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."recipe_status" AS ENUM('proposed', 'confirmed', 'superseded', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('queued', 'provisioning', 'building', 'planning', 'running', 'comparing', 'publishing', 'tearing_down', 'completed', 'inconclusive', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."review_verdict" AS ENUM('pass', 'fail', 'inconclusive');--> statement-breakpoint
CREATE TABLE "agent_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" varchar(32) DEFAULT 'openai' NOT NULL,
	"mode" "agent_connection_mode" NOT NULL,
	"status" "agent_connection_status" DEFAULT 'pending' NOT NULL,
	"key_version" integer,
	"iv" text,
	"ciphertext" text,
	"auth_tag" text,
	"zcp_project_id" varchar(100),
	"zcp_service_id" varchar(100),
	"last_verified_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_connections_mode_material" CHECK (("agent_connections"."mode" = 'managed' and "agent_connections"."ciphertext" is null and "agent_connections"."zcp_project_id" is null)
        or ("agent_connections"."mode" = 'api_key' and "agent_connections"."key_version" is not null and "agent_connections"."iv" is not null and "agent_connections"."ciphertext" is not null and "agent_connections"."auth_tag" is not null and "agent_connections"."zcp_project_id" is null)
        or ("agent_connections"."mode" = 'codex_workspace' and "agent_connections"."ciphertext" is null and "agent_connections"."zcp_project_id" is not null and "agent_connections"."zcp_service_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"side" "artifact_side" NOT NULL,
	"kind" varchar(60) NOT NULL,
	"storage_key" text NOT NULL,
	"media_type" varchar(120) NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"label" varchar(160) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"severity" "finding_severity" NOT NULL,
	"kind" varchar(80) NOT NULL,
	"title" varchar(240) NOT NULL,
	"summary" text NOT NULL,
	"first_divergent_step" integer NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"github_user_id" bigint NOT NULL,
	"login" varchar(100) NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"github_installation_id" bigint NOT NULL,
	"account_id" bigint NOT NULL,
	"account_login" varchar(120) NOT NULL,
	"account_type" varchar(24) NOT NULL,
	"repository_selection" varchar(24) NOT NULL,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"kind" varchar(60) NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"locked_by" varchar(160),
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"installation_id" uuid NOT NULL,
	"github_repository_id" bigint NOT NULL,
	"owner" varchar(120) NOT NULL,
	"name" varchar(120) NOT NULL,
	"default_branch" varchar(255) NOT NULL,
	"is_private" boolean NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{"automaticReviews":true}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repository_recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "recipe_status" DEFAULT 'proposed' NOT NULL,
	"source_sha" varchar(40) NOT NULL,
	"proposal" jsonb NOT NULL,
	"policy_decision" jsonb NOT NULL,
	"approved_recipe" jsonb,
	"fingerprint" varchar(64),
	"proposed_by_user_id" uuid,
	"confirmed_by_user_id" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repository_recipes_version_positive" CHECK ("repository_recipes"."version" > 0),
	CONSTRAINT "repository_recipes_source_sha_format" CHECK ("repository_recipes"."source_sha" ~ '^[0-9a-f]{40}$'),
	CONSTRAINT "repository_recipes_confirmation_complete" CHECK (("repository_recipes"."status" <> 'confirmed') or ("repository_recipes"."approved_recipe" is not null and "repository_recipes"."fingerprint" is not null and "repository_recipes"."confirmed_by_user_id" is not null and "repository_recipes"."confirmed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "repository_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"key_version" integer NOT NULL,
	"iv" text NOT NULL,
	"ciphertext" text NOT NULL,
	"auth_tag" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"review_id" uuid NOT NULL,
	"type" varchar(80) NOT NULL,
	"message" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"repository_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"pull_number" integer NOT NULL,
	"title" varchar(240) NOT NULL,
	"base_sha" varchar(40) NOT NULL,
	"head_sha" varchar(40) NOT NULL,
	"status" "review_status" DEFAULT 'queued' NOT NULL,
	"verdict" "review_verdict",
	"provider" "execution_provider" NOT NULL,
	"status_message" text DEFAULT 'Waiting for a runner' NOT NULL,
	"plan" jsonb,
	"provider_project_id" varchar(100),
	"provider_ownership_token_hash" varchar(64),
	"base_url" text,
	"head_url" text,
	"check_run_id" bigint,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"teardown_started_at" timestamp with time zone,
	"teardown_completed_at" timestamp with time zone,
	"teardown_attempts" integer DEFAULT 0 NOT NULL,
	"teardown_last_error" text,
	"teardown_proof" jsonb,
	"cancel_requested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_pull_number_positive" CHECK ("reviews"."pull_number" > 0),
	CONSTRAINT "reviews_base_sha_format" CHECK ("reviews"."base_sha" ~ '^[0-9a-f]{40}$'),
	CONSTRAINT "reviews_head_sha_format" CHECK ("reviews"."head_sha" ~ '^[0-9a-f]{40}$'),
	CONSTRAINT "reviews_distinct_shas" CHECK ("reviews"."base_sha" <> "reviews"."head_sha"),
	CONSTRAINT "reviews_teardown_attempts_nonnegative" CHECK ("reviews"."teardown_attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"delivery_id" uuid PRIMARY KEY NOT NULL,
	"event_name" varchar(80) NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_connections" ADD CONSTRAINT "agent_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_accounts" ADD CONSTRAINT "github_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_installation_id_github_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."github_installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_recipes" ADD CONSTRAINT "repository_recipes_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_recipes" ADD CONSTRAINT "repository_recipes_proposed_by_user_id_users_id_fk" FOREIGN KEY ("proposed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_recipes" ADD CONSTRAINT "repository_recipes_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_secrets" ADD CONSTRAINT "repository_secrets_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_recipe_id_repository_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."repository_recipes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_connections_user_provider_unique" ON "agent_connections" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "agent_connections_status_idx" ON "agent_connections" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "artifacts_review_created_idx" ON "artifacts" USING btree ("review_id","created_at");--> statement-breakpoint
CREATE INDEX "findings_review_idx" ON "findings" USING btree ("review_id");--> statement-breakpoint
CREATE UNIQUE INDEX "github_accounts_user_unique" ON "github_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "github_accounts_github_user_unique" ON "github_accounts" USING btree ("github_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "github_installations_remote_unique" ON "github_installations" USING btree ("github_installation_id");--> statement-breakpoint
CREATE INDEX "github_installations_owner_idx" ON "github_installations" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("status","available_at","created_at");--> statement-breakpoint
CREATE INDEX "jobs_review_idx" ON "jobs" USING btree ("review_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_one_active_review_unique" ON "jobs" USING btree ("review_id","kind") WHERE "jobs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "repositories_remote_unique" ON "repositories" USING btree ("github_repository_id");--> statement-breakpoint
CREATE INDEX "repositories_installation_idx" ON "repositories" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "repositories_active_idx" ON "repositories" USING btree ("installation_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "repository_recipes_version_unique" ON "repository_recipes" USING btree ("repository_id","version");--> statement-breakpoint
CREATE INDEX "repository_recipes_status_idx" ON "repository_recipes" USING btree ("repository_id","status","version");--> statement-breakpoint
CREATE INDEX "repository_recipes_fingerprint_idx" ON "repository_recipes" USING btree ("repository_id","fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "repository_secrets_name_unique" ON "repository_secrets" USING btree ("repository_id","name");--> statement-breakpoint
CREATE INDEX "repository_secrets_repository_idx" ON "repository_secrets" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "review_events_review_cursor_idx" ON "review_events" USING btree ("review_id","id");--> statement-breakpoint
CREATE INDEX "reviews_owner_created_idx" ON "reviews" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "reviews_repository_created_idx" ON "reviews" USING btree ("repository_id","created_at");--> statement-breakpoint
CREATE INDEX "reviews_recipe_idx" ON "reviews" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "reviews_status_created_idx" ON "reviews" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "reviews_cleanup_idx" ON "reviews" USING btree ("status","teardown_completed_at","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_repo_pr_head_unique" ON "reviews" USING btree ("repository_id","pull_number","head_sha") WHERE "reviews"."pull_number" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");