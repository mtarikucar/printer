-- 0070 geri alma: `quote_parts.source_format` listesi üç değerine döner ve
-- STEP'in birim kilidi düşer. Elle uygulanır (psql); journal'da yer almaz.
--
-- ─── SIRA ZORUNLU — ÖNCE UYGULAMA, SONRA BU DOSYA ──────────────────────────
--
-- (1) app + worker imajları 0070 ÖNCESİ commit'e geri alınır ve doğrulanır,
-- (2) ancak ondan SONRA bu dosya çalıştırılır.
--
-- Tersi yapılırsa kod `"step"`i kabul etmeye devam ederken veritabanı onu
-- reddeder: her STEP yüklemesi 23514 ile BOŞ GÖVDELİ 500 döner (uzantı kapısı
-- `quote-model-validation.ts`te geçer, satır `quote_parts`a yazılırken düşer).
-- Müşteri tarafında bu "dosyam bozuk" gibi görünür; günlükte yalnız kısıdın adı
-- vardır. Ayrıntı: scripts/db/README.md.
--
-- ─── REDDEDER: YAZILMIŞ BİR `step` SATIRI VARSA DURUR ──────────────────────
--
-- Daraltılmış CHECK (`'stl', 'obj', '3mf'`) `source_format = 'step'` satırlarıyla
-- KURULAMAZ. "Zorlamak" tek bir anlama gelirdi: müşterinin parçasını SİLMEK.
-- Yani bu geri alma, bir STEP satırı yazıldıktan sonra YIKICIDIR ve bu yüzden
-- hiçbir şeye dokunmadan durur — kısıt da düşmez, journal satırı da silinmez
-- (ret bir `RAISE EXCEPTION`; blok atomik olarak geri sarılır).
--
-- `deleted_at` DOLU satırlar da SAYILIR: yumuşak silme satırı tabloda bırakır,
-- yani CHECK'i kurtarmaz. Kestirme yoktur; o satırlar müşteri verisidir.
--
-- Geri alma yine de isteniyorsa yol şudur: ilgili teklifleri/parçaları müşteriyle
-- birlikte kapatın (gerekirse dışa aktarıp bilerek silin), sonra bu dosyayı
-- yeniden çalıştırın. Bulmak için:
--   SELECT p.id, p.quote_id, q.number, p.file_name, p.deleted_at
--     FROM quote_parts p JOIN quotes q ON q.id = p.quote_id
--    WHERE p.source_format = 'step';
--
-- Yalnız up'ın EKLEDİĞİ iki kısıda dokunur. 0064'ün öteki kısıtları
-- (`quote_parts_analysis_status_chk`, `..._units_chk`, `..._quantity_chk`,
-- `..._scale_chk`) YERİNDE KALIR. Hiçbir satır, kolon ya da tablo silinmez;
-- operatör/müşteri verisine dokunulmaz. `IF EXISTS` sayesinde tekrar
-- çalıştırılabilir; kilit, DDL ve journal satırının silinmesi tek işlemde atomik.
--
-- ─── DRIZZLE KAYIT SATIRI: KENDİ SATIRINI SİLER ─────────────────────────────
--
-- Silinen satır 0070'in KENDİ etiketidir: `created_at`, journal'daki `when`
-- değeridir (drizzle/meta/_journal.json · idx 70 · tag 0070_step_format ·
-- when 1790787200000). "En son eklenen satırı sil" (ORDER BY created_at DESC
-- LIMIT 1) tarifi YASAKTIR: 0070 en yeni olmayabilir ve o tarif başka bir
-- migration'ın kaydını silerdi. `hash` ile silmek de yasaktır — hash dosya
-- İÇERİĞİNİN sha256'sıdır, dosya her düzeltildiğinde değişir ve silme sessizce
-- hiçbir satıra dokunmaz.
--
-- Altındaki bir migration da geri alınacaksa SIRA EN YENİDEN ESKİYE doğrudur:
-- ilk bu dosya, sonra 0067, 0066, 0065, 0064 … (tam tarif:
-- drizzle/0055_qc_photo_model_revision.down.sql).
DO $$
DECLARE
  used boolean;
BEGIN
  SET LOCAL lock_timeout = '5s';
  IF to_regclass('public.quote_parts') IS NOT NULL THEN
    LOCK TABLE public.quote_parts IN ACCESS EXCLUSIVE MODE;
    SELECT EXISTS (SELECT 1 FROM public.quote_parts WHERE source_format = 'step') INTO used;
    IF used THEN
      RAISE EXCEPTION '0070 geri alma reddedildi: quote_parts içinde source_format = ''step'' satırı var (yumuşak silinmişler dâhil). Üç değerli CHECK bu satırlarla KURULAMAZ, zorlamak müşterinin parçasını silmek olurdu. Yapılacak: o teklifleri/parçaları müşteriyle kapatıp (gerekirse dışa aktarıp) kaldırın, sonra bu dosyayı yeniden çalıştırın. Bulmak için: SELECT id, quote_id, file_name, deleted_at FROM quote_parts WHERE source_format = ''step'';';
    END IF;
    -- Ters sıra: önce birim kilidi, sonra liste daraltılır.
    ALTER TABLE public.quote_parts DROP CONSTRAINT IF EXISTS quote_parts_step_units_chk;
    ALTER TABLE public.quote_parts DROP CONSTRAINT IF EXISTS quote_parts_source_format_chk;
    ALTER TABLE public.quote_parts ADD CONSTRAINT quote_parts_source_format_chk
      CHECK (source_format IN ('stl', 'obj', '3mf'));
  END IF;
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1790787200000;
  END IF;
END $$;
