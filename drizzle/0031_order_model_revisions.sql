CREATE TABLE "order_model_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"glb_key" text NOT NULL,
	"glb_url" text NOT NULL,
	"stl_key" text,
	"stl_url" text,
	"uploaded_by_email" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_model_revisions" ADD CONSTRAINT "order_model_revisions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_model_revisions_order_rev_idx" ON "order_model_revisions" USING btree ("order_id","revision");