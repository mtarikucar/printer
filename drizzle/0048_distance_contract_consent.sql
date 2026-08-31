-- Mesafeli sözleşme ön bilgilendirme onayı (MSY m.6/2-a) + önizleme onay damgası.
-- Hepsi nullable: geçmiş siparişlerde bu onay ALINMADI ve sonradan uydurulamaz.
-- NULL = "onay kaydı yok" ve öyle kalmalıdır — backfill YAPILMAZ.
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "preliminary_info_accepted_at" timestamp;--> statement-breakpoint
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "preliminary_info_version" text;--> statement-breakpoint
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "distance_contract_version" text;--> statement-breakpoint
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "consent_ip" text;--> statement-breakpoint
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "consent_user_agent" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "preliminary_info_accepted_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "preliminary_info_version" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "distance_contract_version" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "consent_ip" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "consent_user_agent" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "preview_approved_at" timestamp;