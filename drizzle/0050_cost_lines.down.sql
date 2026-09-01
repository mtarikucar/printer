-- 0050 geri alma.
--
-- DİKKAT — bu geri alma KAYIPLIDIR: `production_base_kurus` kolonları düşünce
-- her siparişin üretim/boyama kırılımı KALICI olarak silinir. Tahakkuk etmiş
-- manufacturer_earnings / painter_earnings satırları olduğu gibi kalır (para
-- kaybolmaz) ve services/earning-base.ts eski, kırılımsız kurala geri döner —
-- ama hangi siparişin ne kadarının boyama olduğu bilgisi geri getirilemez.
-- Geri almadan önce yedek alın.
--
-- Ayrıca `drizzle-kit migrate` uygulanmış migration'ları kendi tablosunda
-- tutar: bu dosyayı çalıştırdıktan sonra 0050'nin yeniden uygulanabilmesi için
-- kaydını da silmek gerekir:
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash =
--     (SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1);
--
-- Yalnızca up'ın eklediklerini kaldırır; operatör/müşteri verisine dokunmaz.
-- Tekrar çalıştırılabilir (IF EXISTS).
SET lock_timeout = '5s';
DROP INDEX IF EXISTS "product_cost_lines_product_idx";
DROP TABLE IF EXISTS "product_cost_lines";
ALTER TABLE "order_items" DROP COLUMN IF EXISTS "production_base_kurus";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "production_base_kurus";
ALTER TABLE "order_drafts" DROP COLUMN IF EXISTS "production_base_kurus";
