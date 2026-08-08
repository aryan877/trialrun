ALTER TABLE "repository_analysis_jobs" ADD COLUMN "agent_connection_id" uuid;--> statement-breakpoint
UPDATE "repository_analysis_jobs"
SET
	"status" = 'failed',
	"locked_by" = NULL,
	"lease_expires_at" = NULL,
	"last_error" = 'Legacy analysis job has no exact OpenAI connection pin and cannot run.',
	"updated_at" = now()
WHERE "agent_connection_id" IS NULL
	AND "status" IN ('queued', 'running');--> statement-breakpoint
ALTER TABLE "repository_analysis_jobs" ADD CONSTRAINT "repository_analysis_jobs_connection_fk" FOREIGN KEY ("agent_connection_id") REFERENCES "public"."agent_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repository_analysis_jobs_agent_connection_idx" ON "repository_analysis_jobs" USING btree ("agent_connection_id","created_at");--> statement-breakpoint
ALTER TABLE "repository_analysis_jobs" ADD CONSTRAINT "repository_analysis_jobs_active_connection_pin" CHECK ("repository_analysis_jobs"."agent_connection_id" is not null or "repository_analysis_jobs"."status" in ('succeeded', 'failed'));
