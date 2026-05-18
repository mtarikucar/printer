CREATE TABLE "manufacturer_assignment_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"v1_winner_id" uuid,
	"v2_winner_id" uuid,
	"v1_scores" jsonb,
	"v2_scores" jsonb,
	"weights_version" text NOT NULL,
	"authoritative" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "manufacturer_assignment_evaluations" ADD CONSTRAINT "manufacturer_assignment_evaluations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturer_assignment_evaluations" ADD CONSTRAINT "manufacturer_assignment_evaluations_v1_winner_id_manufacturers_id_fk" FOREIGN KEY ("v1_winner_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturer_assignment_evaluations" ADD CONSTRAINT "manufacturer_assignment_evaluations_v2_winner_id_manufacturers_id_fk" FOREIGN KEY ("v2_winner_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mfg_eval_order_version_idx" ON "manufacturer_assignment_evaluations" USING btree ("order_id","weights_version");