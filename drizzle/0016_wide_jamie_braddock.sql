-- Relax the figurine "style" column from a pg enum to text so design templates
-- can be added via the registry without a migration. Drop the column default
-- before the type change (Postgres cannot auto-cast an enum default to text),
-- re-apply it as text, then drop the now-unused enum type.
ALTER TABLE "order_drafts" ALTER COLUMN "style" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "order_drafts" ALTER COLUMN "style" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "order_drafts" ALTER COLUMN "style" SET DEFAULT 'realistic';--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "style" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "style" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "style" SET DEFAULT 'realistic';--> statement-breakpoint
ALTER TABLE "previews" ALTER COLUMN "style" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "previews" ALTER COLUMN "style" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "previews" ALTER COLUMN "style" SET DEFAULT 'realistic';--> statement-breakpoint
DROP TYPE "public"."figurine_style";
