-- 0073 geri alma: üç çerçeve tablosu düşer ve denetim CHECK'i eski YEDİ
-- değerine döner. Elle uygulanır (psql); journal'da yer almaz.
--
-- ─── SIRA ZORUNLU — ÖNCE UYGULAMA, SONRA BU DOSYA ──────────────────────────
--
-- (1) app + worker imajları 0073 ÖNCESİ commit'e geri alınır ve doğrulanır,
-- (2) `framework_orders_enabled` kapatılır, planlı partiler ya serbest
--     bırakılır ya iptal edilir, ödenmiş partiler normal akışta biter,
-- (3) ancak ondan SONRA bu dosya çalıştırılır.
--
-- Tersi yapılırsa kod tabloları adıyla yazmaya devam eder: anlaşma/parti
-- yazımı 42P01 ile düşer ve admin BOŞ GÖVDELİ bir 500 görür. Ayrıntı:
-- scripts/db/README.md.
--
-- Serbest bırakılmış partilerin KLON teklifleri sıradan `quotes` satırıdır:
-- bu geri alma onlara DOKUNMAZ ve ödenmeye devam ederler. Geri dönüşün en
-- değerli özelliği bu — hiçbir ödenmiş/ödenecek parti tuzağa düşmez.
--
-- ─── REDDEDER, YIKMAZ: İMZALANMIŞ ANLAŞMA MÜŞTERİ VERİSİDİR ───────────────
--
-- İki ret koşulu var ve ikisi de aynı sebeple ince ayarlı:
--
--   * `quote_frameworks`ta TEK satır varsa geri alma DURUR. Bir çerçeve
--     anlaşma bir SÖZLEŞMEDİR: taahhüt edilen adet, kilitli birim fiyatlar,
--     fiyat geçerlilik tarihi ve müşterinin kabul damgası (`terms_accepted_at`
--     / `terms_version`) yalnız orada yazılıdır. Onu silmek bir hesap kaydını
--     değil bir SÖZLEŞMEYİ silmektir; teslim edilmiş bir partinin hangi
--     taahhüde sayıldığı da o satırdan okunur.
--   * `quote_admin_actions`ta `framework_*` bir eylem varsa geri alma DURUR.
--     Tablolar boşaltılmış olsa bile denetim izi "bu anlaşma vardı, şu parti
--     serbest bırakıldı" diyor ve CHECK daraltıldığında o satırlar kısıtla
--     ÇELİŞİR (kısıt bu hâlde kurulamaz, 23514).
--
-- Ret bir `RAISE EXCEPTION`dır ve dosya TEK bir `DO` bloğudur: blok atomik
-- olarak geri sarılır, üç tablo ve CHECK YERİNDE kalır, yarım iş bırakılmaz.
-- CASCADE YOK: hiçbir bağlı satır sessizce düşmez.
--
-- Gerçekten silinmesi isteniyorsa ÖNCE yanına alın (ve müşteriyle anlaşmayı
-- kapatın):
--   \copy (SELECT * FROM quote_frameworks) TO 'quote_frameworks.csv' CSV HEADER
--   \copy (SELECT * FROM quote_framework_batches) TO 'quote_framework_batches.csv' CSV HEADER
--   \copy (SELECT * FROM quote_framework_batch_lines) TO 'quote_framework_batch_lines.csv' CSV HEADER
--   DELETE FROM quote_framework_batch_lines;
--   DELETE FROM quote_framework_batches;
--   DELETE FROM quote_frameworks;
--   DELETE FROM quote_admin_actions WHERE action LIKE 'framework\_%';
-- Bulmak için:
--   SELECT number, status, committed_units, price_locked_until FROM quote_frameworks ORDER BY created_at;
--
-- Yalnız up'ın EKLEDİĞİ tablolara ve kısıda dokunur; `quote_admin_actions`ın
-- satırları, teklifler, siparişler ve operatör verisi YERİNDE KALIR.
-- `IF EXISTS` sayesinde tekrar çalıştırılabilir; kilit, ret kontrolü, DDL ve
-- journal satırının silinmesi tek işlemde atomiktir.
--
-- ─── DRIZZLE KAYIT SATIRI: KENDİ SATIRINI SİLER ─────────────────────────────
--
-- Silinen satır 0073'ün KENDİ etiketidir: `created_at`, journal'daki `when`
-- değeridir (drizzle/meta/_journal.json · idx 73 · tag 0073_framework_orders ·
-- when 1790798000000). "En son eklenen satırı sil" (ORDER BY created_at DESC
-- LIMIT 1) tarifi YASAKTIR: 0073 en yeni olmayabilir ve o tarif başka bir
-- migration'ın kaydını silerdi (0050-0054'ün teşhis edilmiş hatası). `hash` ile
-- silmek de yasaktır — hash dosya İÇERİĞİNİN sha256'sıdır, dosya her
-- düzeltildiğinde değişir ve silme sessizce hiçbir satıra dokunmaz.
--
-- Altındaki bir migration da geri alınacaksa SIRA EN YENİDEN ESKİYE doğrudur:
-- ilk bu dosya, sonra 0071, 0070, 0067 … (tam tarif:
-- drizzle/0055_qc_photo_model_revision.down.sql).
DO $$
BEGIN
  SET LOCAL lock_timeout = '5s';
  IF to_regclass('public.quote_frameworks') IS NOT NULL THEN
    -- Tabloyu düşürmekle "sözleşme var mı" okuması arasına kimse girmesin.
    LOCK TABLE public.quote_frameworks IN ACCESS EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM public.quote_frameworks) THEN
      RAISE EXCEPTION '0073 rollback refused: çerçeve anlaşma kaydı var (sözleşme verisi). Yapılacak: anlaşmaları dışa aktarın (\copy tarifi bu dosyanın başında), müşteriyle taahhüdü kapatın ve satırları silin, sonra bu dosyayı yeniden çalıştırın. Bulmak için: SELECT number, status, committed_units FROM quote_frameworks ORDER BY created_at;';
    END IF;
  END IF;
  IF to_regclass('public.quote_admin_actions') IS NOT NULL THEN
    LOCK TABLE public.quote_admin_actions IN ACCESS EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM public.quote_admin_actions WHERE action LIKE 'framework\_%') THEN
      RAISE EXCEPTION '0073 rollback refused: çerçeve denetim izi var (quote_admin_actions.action LIKE ''framework_%%''). Yapılacak: izi dışa aktarın ve silin, sonra bu dosyayı yeniden çalıştırın. Bulmak için: SELECT quote_id, action, admin_email, created_at FROM quote_admin_actions WHERE action LIKE ''framework\_%%'';';
    END IF;
  END IF;
  -- DROP sırası FK'nin TERSİ. CASCADE YOK.
  DROP TABLE IF EXISTS public.quote_framework_batch_lines;
  DROP TABLE IF EXISTS public.quote_framework_batches;
  DROP TABLE IF EXISTS public.quote_frameworks;
  -- Denetim listesi eski YEDİ değere döner (0073 öncesi hâl).
  IF to_regclass('public.quote_admin_actions') IS NOT NULL THEN
    ALTER TABLE public.quote_admin_actions DROP CONSTRAINT IF EXISTS quote_admin_actions_action_chk;
    ALTER TABLE public.quote_admin_actions ADD CONSTRAINT quote_admin_actions_action_chk
      CHECK (action IN ('manual_price', 'target_accept', 'target_counter', 'target_reject', 'review_reject', 'extend_expiry', 'reopen'));
  END IF;
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1790798000000;
  END IF;
END $$;
