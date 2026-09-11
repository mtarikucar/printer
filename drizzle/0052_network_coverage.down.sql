-- 0052 geri alma.
--
-- Yalnız up'ın eklediği üç kolonu düşürür; başka hiçbir veriye dokunmaz.
-- Tekrar çalıştırılabilir (IF EXISTS). Kolonlarla birlikte admin'in girdiği
-- etki alanı verisi de gider — geri almadan önce yedek al.
--
-- Ayrıca `drizzle-kit migrate` uygulanmış migration'ları kendi tablosunda
-- tutar: bu dosyayı çalıştırdıktan sonra 0052'nin yeniden uygulanabilmesi için
-- kaydını da silmek gerekir (0050/0051'deki aynı not):
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash =
--     (SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1);
SET lock_timeout = '5s';
ALTER TABLE "painters" DROP COLUMN IF EXISTS "map_visible";
ALTER TABLE "manufacturers" DROP COLUMN IF EXISTS "map_visible";
ALTER TABLE "manufacturers" DROP COLUMN IF EXISTS "coverage_provinces";
