-- 0057 geri alma.
--
-- `painter_assignment_evaluations` tablosu düşer. DİKKAT: tablodaki KARAR
-- KAYITLARI da gider ve geri gelmez — kolon değil, tablonun tamamıdır. Karar
-- geçmişi bir ortağın "neden bu iş bana gelmedi / neden benden alındı"
-- sorusunun tek kanıtıdır; geri almadan ÖNCE yanına al:
--   \copy (SELECT * FROM painter_assignment_evaluations) TO 'painter_evals.csv' CSV HEADER
--
-- UYGULAMAYI KIRMAZ: tablo yalnız telemetridir. Yazıcı hatayı yutar ve Türkçe
-- uyarıya çevirir (recordPainterEvaluation, services/painter-evaluation.ts),
-- gösterim okuması da 42P01'de boş liste döndürüp sayfayı ayakta tutar
-- (listPainterEvaluationsForOrder). Hiçbir KAPI bu tablodan beslenmez, yani
-- tablonun yokluğu kimseye bir hak açmaz ve hiçbir atamayı durdurmaz — 0057
-- öncesi davranışa dönülür.
--
-- İndeksler ve FK'ler tablonun parçası oldukları için ayrıca düşürülmez;
-- DROP TABLE üçünü de alır. Tekrar çalıştırılabilir (IF EXISTS) ve yalnız
-- up'ın yarattığı tabloya dokunur; operatör/müşteri/para verisine dokunmaz.
--
-- ─── DRIZZLE KAYIT SATIRI: KENDİ SATIRINI SİLER, "EN YENİSİNİ" DEĞİL ───────
--
-- `drizzle-kit migrate` uygulanmış her migration'ı kendi tablosunda tutar; bu
-- dosyadan sonra 0057'nin yeniden uygulanabilmesi için KAYDININ da silinmesi
-- gerekir. 0050-0054'ten kopyalanan "en son eklenen satırı sil" tarifi
-- (ORDER BY created_at DESC LIMIT 1) yalnız 0057 EN YENİ migration olduğu
-- sürece doğrudur: üstüne 0058 eklendiği an BAŞKASININ satırını siler, 0057'nin
-- kaydı yerinde kalır ve 0057 bir daha asla uygulanmaz — migrate "başarılı"
-- der, tablo düşük kalır ve her boyacı ataması sessizce kayıtsız geçer.
--
-- Bu yüzden satır KENDİ ETİKETİYLE silinir; etiketin kimliği `created_at`tir:
-- drizzle oraya journal'daki `when` değerini yazar
-- (drizzle/meta/_journal.json · idx 57 · tag 0057_painter_assignment_evaluations
-- · when 1789556775560). `hash` ile SİLİNMEZ: hash dosya İÇERİĞİNİN sha256'sı,
-- dosya her düzeltildiğinde değişir ve kayıttaki eski hash'le eşleşmez.
--
-- Silme BU DOSYADA ÇALIŞIR (yalnız yorumda tarif edilmez), ama drizzle şeması
-- hiç yoksa (migration'ları psql ile kuran scratch/QA veritabanları) sessizce
-- atlanır — yoksa geri alma orada hata verirdi.
--
-- SIRA ÖNEMLİ — 0057 en yeni DEĞİLSE tek başına bu silme yetmez. Migrator yalnız
-- EN YENİ kaydın `created_at`ine bakar (drizzle-orm/pg-core/dialect.js: "order
-- by created_at desc limit 1" + `lastDbMigration.created_at <
-- migration.folderMillis`), yani 0057'den SONRA kaydedilmiş bir satır (0058, …)
-- dururken 0057 yeniden uygulanmaz. Önce ÜSTÜNDEKİLER kendi down dosyalarıyla
-- ve kendi satırlarıyla geri alınır, sonra bu dosya çalıştırılır; ardından:
--   npm run db:migrate   -- hepsini yeniden uygular (hepsi idempotent)
SET lock_timeout = '5s';
DROP TABLE IF EXISTS "painter_assignment_evaluations";
DO $$ BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1789556775560;
  END IF;
END $$;
