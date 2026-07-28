-- Figurine size: pg enum -> text. An order can now carry a real measurement
-- ("17,5 cm", "15×10×22 cm") instead of being forced into three fixed tiers.
-- Same shape as the `style` column's enum->text move (0016). enum -> text is an
-- assignment cast, so no USING is needed and existing 'kucuk'/'orta'/'buyuk'
-- rows survive verbatim; SET DATA TYPE keeps previews.figurine_size NOT NULL.
ALTER TABLE "order_drafts" ALTER COLUMN "figurine_size" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "figurine_size" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "previews" ALTER COLUMN "figurine_size" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."figurine_size";