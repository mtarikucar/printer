-- 0048 geri alma. Yalnızca up'ın eklediği kolonları düşürür; başka hiçbir
-- veriye dokunmaz. Tekrar çalıştırılabilir (IF EXISTS).
ALTER TABLE "orders" DROP COLUMN IF EXISTS "preview_approved_at";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "consent_user_agent";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "consent_ip";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "distance_contract_version";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "preliminary_info_version";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "preliminary_info_accepted_at";
ALTER TABLE "order_drafts" DROP COLUMN IF EXISTS "consent_user_agent";
ALTER TABLE "order_drafts" DROP COLUMN IF EXISTS "consent_ip";
ALTER TABLE "order_drafts" DROP COLUMN IF EXISTS "distance_contract_version";
ALTER TABLE "order_drafts" DROP COLUMN IF EXISTS "preliminary_info_version";
ALTER TABLE "order_drafts" DROP COLUMN IF EXISTS "preliminary_info_accepted_at";
