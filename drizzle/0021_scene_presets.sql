CREATE TABLE "scene_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"prompt_fragment" text DEFAULT '' NOT NULL,
	"people_hint" text DEFAULT 'any' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scene_presets_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "previews" ADD COLUMN "scene" text;--> statement-breakpoint
ALTER TABLE "previews" ADD COLUMN "scene_custom_text" text;