-- 0050 geri alma. Yalnızca up'ın eklediklerini kaldırır: iki kolon ve kalem
-- tablosu. Sipariş/hakediş verisine dokunmaz — kolonlar düşünce
-- services/earning-base.ts eski (kırılımsız) kurala geri döner, tahakkuk etmiş
-- manufacturer_earnings / painter_earnings satırları olduğu gibi kalır.
-- Tekrar çalıştırılabilir (IF EXISTS).
DROP INDEX IF EXISTS "product_cost_lines_product_idx";
DROP TABLE IF EXISTS "product_cost_lines";
ALTER TABLE "order_items" DROP COLUMN IF EXISTS "production_base_kurus";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "production_base_kurus";
ALTER TABLE "order_drafts" DROP COLUMN IF EXISTS "production_base_kurus";
