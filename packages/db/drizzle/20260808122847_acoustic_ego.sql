DROP INDEX "reviews_cleanup_idx";--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "teardown_max_attempts" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "teardown_available_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "teardown_locked_by" varchar(160);--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "teardown_lease_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "reviews_zerops_cleanup_claim_idx" ON "reviews" USING btree ("teardown_available_at","created_at") WHERE "reviews"."provider" = 'zerops' and "reviews"."provider_project_id" is not null and "reviews"."teardown_completed_at" is null and "reviews"."status" in ('completed', 'inconclusive', 'cancelled');--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_teardown_max_attempts_bounded" CHECK ("reviews"."teardown_max_attempts" between 1 and 20);