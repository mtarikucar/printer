-- 0052 — üretim ağı haritası: partner etki alanı + harita görünürlüğü.
--
-- `manufacturers.coverage_provinces`: bir atölyenin SORUMLU olduğu iller
-- (kendi ili hariç; etkin kapsama kodda birleştirilir). Hem anasayfadaki public
-- haritayı hem atama mesafe skorunu besler.
-- `map_visible`: partneri public haritadan çıkarır (iki tabloda da).
-- Boyacılarda kapsama kolonu YOK — boyacıyı üretici elle seçiyor, mesafeye göre
-- sıralayan bir ranker bulunmuyor.
--
-- ADD COLUMN + sabit DEFAULT PG11+'ta tabloyu yeniden yazmaz (yalnız katalog
-- güncellenir), yine de kısa süreli ACCESS EXCLUSIVE kilit ister. Canlıda
-- `manufacturers` sürekli okunuyor: kilit hemen alınamazsa deploy'u dakikalarca
-- bekletmek yerine hızlı başarısız olsun.
--
-- Idempotent: bir kez uygulanmış bir veritabanında yeniden çalıştırılabilir.
SET lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "manufacturers" ADD COLUMN IF NOT EXISTS "coverage_provinces" jsonb;--> statement-breakpoint
ALTER TABLE "manufacturers" ADD COLUMN IF NOT EXISTS "map_visible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "painters" ADD COLUMN IF NOT EXISTS "map_visible" boolean DEFAULT true NOT NULL;
