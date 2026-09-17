-- 0058 geri alma.
--
-- `coverage_overrides` YALNIZ BOŞSA düşer. Pin ve dışlama operatör verisidir;
-- tek bir satır bile varsa geri alma hata verir, tablo ve migration kaydı
-- aynen kalır. Bu dosya kararları silmez veya bir yedeğe taşımaz. Operatörün
-- ayrıca onayladığı veri koruma/taşıma süreci tamamlanmadan geri alınamaz.
--
-- Public harita artık hesaplanan planı okur; canlı sıralama hâlâ
-- `manufacturers.coverage_provinces` kolonunu okur (ranker-rollout = B).
-- Tablo yokken plan saf hesaba DÜŞMEZ: yükleme hata verir, /admin/coverage
-- çalışmaz ve anasayfa hatayı yakalayıp harita bölümünü göstermez. Şema geri
-- alma, bu tabloyu okuyan uygulama sürümünün de geri alınmasıyla eşlenmelidir.
--
-- İndeksler ve FK tablonun parçası oldukları için ayrıca düşürülmez; DROP TABLE
-- üçünü de alır. Tekrar çalıştırılabilir (IF EXISTS) ve YALNIZ up'ın yarattığı
-- tabloya dokunur: operatör, müşteri, sipariş ve para verisine —
-- `manufacturers.coverage_provinces` dâhil — elini sürmez.
--
-- ─── DRIZZLE KAYIT SATIRI: KENDİ SATIRINI SİLER, "EN YENİSİNİ" DEĞİL ───────
--
-- `drizzle-kit migrate` uygulanmış her migration'ı kendi tablosunda tutar; bu
-- dosyadan sonra 0058'in yeniden uygulanabilmesi için KAYDININ da silinmesi
-- gerekir. 0050-0054'ten kopyalanan "en son eklenen satırı sil" tarifi
-- (ORDER BY created_at DESC LIMIT 1) yalnız 0058 EN YENİ migration olduğu
-- sürece doğrudur: üstüne 0059 eklendiği an BAŞKASININ satırını siler, 0058'in
-- kaydı yerinde kalır ve 0058 bir daha asla uygulanmaz — migrate "başarılı"
-- der, tablo düşük kalır ve etki alanı ekranı sessizce çalışmaz.
--
-- Bu yüzden satır KENDİ ETİKETİYLE silinir; etiketin kimliği `created_at`tir:
-- drizzle oraya journal'daki `when` değerini yazar
-- (drizzle/meta/_journal.json · idx 58 · tag 0058_coverage_overrides
-- · when 1789582571939). `hash` ile SİLİNMEZ: hash dosya İÇERİĞİNİN sha256'sı,
-- dosya her düzeltildiğinde değişir ve kayıttaki eski hash'le eşleşmez.
--
-- Silme BU DOSYADA ÇALIŞIR (yalnız yorumda tarif edilmez), ama drizzle şeması
-- hiç yoksa (migration'ları psql ile kuran scratch/QA veritabanları) sessizce
-- atlanır — yoksa geri alma orada hata verirdi.
--
-- SIRA ÖNEMLİ — 0058 en yeni DEĞİLSE tek başına bu silme yetmez. Migrator yalnız
-- EN YENİ kaydın `created_at`ine bakar (drizzle-orm/pg-core/dialect.js: "order
-- by created_at desc limit 1" + `lastDbMigration.created_at <
-- migration.folderMillis`), yani 0058'den SONRA kaydedilmiş bir satır (0059, …)
-- dururken 0058 yeniden uygulanmaz. Önce ÜSTÜNDEKİLER kendi down dosyalarıyla
-- ve kendi satırlarıyla geri alınır, sonra bu dosya çalıştırılır; ardından:
--   npm run db:migrate   -- hepsini yeniden uygular (hepsi idempotent)
DO $$ BEGIN
  SET LOCAL lock_timeout = '5s';
  IF to_regclass('public.coverage_overrides') IS NOT NULL THEN
    -- Kontrol ile DROP arasında yazılamaz. Kilit önce alınır; bekleyen bir
    -- yazar commit ettiyse aşağıdaki kontrol onun satırını da görür.
    LOCK TABLE public.coverage_overrides IN ACCESS EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM public.coverage_overrides) THEN
      RAISE EXCEPTION '0058 rollback refused: coverage_overrides contains operator decisions'
        USING HINT = 'Preserve operator decisions through an approved data migration before rollback. No rows were removed.';
    END IF;
    DROP TABLE IF EXISTS public."coverage_overrides";
  END IF;
  -- Kontrol, DROP ve journal silme AYNI atomik DO içindedir. Dışarıdaki
  -- çalıştırıcı transaction açmasa da herhangi bir hata tamamını geri alır.
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1789582571939;
  END IF;
END $$;
