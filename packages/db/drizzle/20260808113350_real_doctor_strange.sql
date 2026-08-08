CREATE TYPE "public"."analysis_job_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "repository_analysis_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"source_sha" varchar(40) NOT NULL,
	"status" "analysis_job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"locked_by" varchar(160),
	"recipe_id" uuid,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repository_analysis_jobs_source_sha_format" CHECK ("repository_analysis_jobs"."source_sha" ~ '^[0-9a-f]{40}$'),
	CONSTRAINT "repository_analysis_jobs_attempts_nonnegative" CHECK ("repository_analysis_jobs"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "repository_recipes" ADD COLUMN "analysis_job_id" uuid;--> statement-breakpoint
ALTER TABLE "repository_analysis_jobs" ADD CONSTRAINT "repository_analysis_jobs_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_analysis_jobs" ADD CONSTRAINT "repository_analysis_jobs_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_analysis_jobs" ADD CONSTRAINT "repository_analysis_jobs_recipe_id_repository_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."repository_recipes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repository_analysis_jobs_claim_idx" ON "repository_analysis_jobs" USING btree ("status","available_at","created_at");--> statement-breakpoint
CREATE INDEX "repository_analysis_jobs_repository_idx" ON "repository_analysis_jobs" USING btree ("repository_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "repository_analysis_jobs_one_active_unique" ON "repository_analysis_jobs" USING btree ("repository_id") WHERE "repository_analysis_jobs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "repository_recipes_analysis_job_unique" ON "repository_recipes" USING btree ("analysis_job_id");