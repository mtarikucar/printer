-- 0054 geri alma.
--
-- İki normal indeks düşer, tekil (order_id, weights_version) indeksi geri gelir.
--
-- DİKKAT: up'tan sonra aynı siparişin İKİNCİ kararı da kaydedilmeye başlar,
-- yani (order_id, weights_version) çifti artık tekrar edebilir. O satırlar
-- uydurma değil GERÇEK karar geçmişidir (geri al + yeniden atama, ret sonrası
-- yeniden atama); geri alma uğruna silmek operasyon verisine dokunmak olurdu.
-- Bu yüzden TEKİL indeks yalnızca tekrar eden satır YOKSA geri konur; varsa
-- aynı adla NORMAL bir indeks kurulur ve NOTICE yazılır.
--
-- Tekilliği gerçekten geri istiyorsan fazlalıkları önce KENDİN ayıkla (her
-- çiftin en yenisini bırakarak), sonra bu dosyayı tekrar çalıştır:
--   DELETE FROM manufacturer_assignment_evaluations a
--   USING manufacturer_assignment_evaluations b
--   WHERE a.order_id = b.order_id
--     AND a.weights_version = b.weights_version
--     AND a.created_at < b.created_at;
--
-- Tekrar çalıştırılabilir (IF EXISTS / IF NOT EXISTS / koşullu) ve yalnız up'ın
-- dokunduğu indekslere dokunur.
--
-- Ayrıca `drizzle-kit migrate` uygulanmış migration'ları kendi tablosunda
-- tutar: bu dosyadan sonra 0054'ün yeniden uygulanabilmesi için kaydını da
-- silmek gerekir (0050-0053'teki aynı not):
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash =
--     (SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1);
SET lock_timeout = '5s';
DROP INDEX IF EXISTS "mfg_eval_order_created_idx";
DROP INDEX IF EXISTS "mfg_eval_created_idx";
-- Ad önce düşürülür ki tekrar çalıştırma DOĞRU indeksi kursun: fazlalıklar
-- ayıklandıktan sonra ikinci bir çalıştırma, ilk çalıştırmanın kurduğu normal
-- indeksi tekil olanla değiştirebilsin (`IF NOT EXISTS` tek başına, ad zaten
-- var olduğu için tekilliği sessizce geri getirmezdi).
DROP INDEX IF EXISTS "mfg_eval_order_version_idx";
DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM "manufacturer_assignment_evaluations"
    GROUP BY "order_id", "weights_version"
    HAVING count(*) > 1
  ) THEN
    CREATE INDEX IF NOT EXISTS "mfg_eval_order_version_idx" ON "manufacturer_assignment_evaluations" USING btree ("order_id","weights_version");
    RAISE NOTICE '0054 down: tekrar eden (order_id, weights_version) satırları var; indeks TEKİL DEĞİL kuruldu. Gerçek karar geçmişi silinmedi.';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "mfg_eval_order_version_idx" ON "manufacturer_assignment_evaluations" USING btree ("order_id","weights_version");
  END IF;
END $$;
