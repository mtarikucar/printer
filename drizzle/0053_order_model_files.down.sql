-- 0053 geri alma.
--
-- `order_model_files` düşer. DİKKAT: bu tablo up'tan sonra uygulamanın yazdığı
-- ÇOK PARÇALI sürümlerin ek parçalarını da tutar (birincil GLB/STL dışındakileri);
-- tablo gidince o parçaların kayıtları da gider. Diskteki dosyalar silinmez,
-- ama hangi sürüme ait oldukları bilgisi kaybolur — geri almadan önce yedek al.
--
-- glb_key / glb_url'e NOT NULL YALNIZCA hiç NULL satır yoksa geri konur. Up'tan
-- sonra yalnız-STL bir sürüm yüklendiyse bu satırlar gerçek operasyon verisidir;
-- onları silmek ya da uydurma bir değerle doldurmak veriye dokunmak olurdu.
-- O durumda kolon NULL kabul eder biçimde bırakılır ve bir NOTICE yazılır.
--
-- Tekrar çalıştırılabilir (IF EXISTS / koşullu). Ayrıca `drizzle-kit migrate`
-- uygulanmış migration'ları kendi tablosunda tutar: bu dosyadan sonra 0053'ün
-- yeniden uygulanabilmesi için kaydını da silmek gerekir:
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash =
--     (SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1);
SET lock_timeout = '5s';
DROP TABLE IF EXISTS "order_model_files";
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "order_model_revisions" WHERE "glb_key" IS NULL OR "glb_url" IS NULL
  ) THEN
    ALTER TABLE "order_model_revisions" ALTER COLUMN "glb_key" SET NOT NULL;
    ALTER TABLE "order_model_revisions" ALTER COLUMN "glb_url" SET NOT NULL;
  ELSE
    RAISE NOTICE '0053 down: GLB''siz sürümler var; glb_key/glb_url NULL kabul eder biçimde bırakıldı.';
  END IF;
END $$;
