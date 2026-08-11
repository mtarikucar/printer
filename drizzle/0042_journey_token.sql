ALTER TABLE "orders" ADD COLUMN "journey_token" text;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_journey_token_unique" UNIQUE("journey_token");