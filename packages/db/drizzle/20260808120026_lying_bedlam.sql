DROP INDEX "reviews_repo_pr_head_unique";--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "locked_by" varchar(64);--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_repo_pr_head_unique" ON "reviews" USING btree ("repository_id","pull_number","head_sha") WHERE "reviews"."status" not in ('completed', 'inconclusive', 'cancelled');