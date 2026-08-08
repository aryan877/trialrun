ALTER TABLE "findings" ALTER COLUMN "first_divergent_step" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "agent_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "agent_mission" jsonb;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "agent_thread_id" varchar(160);--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "agent_terminal_report" jsonb;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "agent_run_metrics" jsonb;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_agent_connection_id_agent_connections_id_fk" FOREIGN KEY ("agent_connection_id") REFERENCES "public"."agent_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reviews_agent_connection_idx" ON "reviews" USING btree ("agent_connection_id");