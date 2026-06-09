ALTER TABLE "generation_attempts" ADD COLUMN "output_obj_url" text;--> statement-breakpoint
ALTER TABLE "previews" ADD COLUMN "obj_url" text;--> statement-breakpoint
ALTER TABLE "previews" ADD COLUMN "obj_key" text;--> statement-breakpoint
ALTER TABLE "previews" ADD COLUMN "stl_url" text;--> statement-breakpoint
ALTER TABLE "previews" ADD COLUMN "stl_key" text;