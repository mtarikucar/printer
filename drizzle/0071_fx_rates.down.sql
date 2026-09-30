-- 0071 geri alma: `fx_rates` tablosu ve `quotes.fx_snapshot` kolonu düşer.
-- Elle uygulanır (psql); journal'da yer almaz.
--
-- ─── SIRA ZORUNLU — ÖNCE UYGULAMA, SONRA BU DOSYA ──────────────────────────
--
-- (1) app + worker imajları 0071 ÖNCESİ commit'e geri alınır ve doğrulanır,
-- (2) ancak ondan SONRA bu dosya çalıştırılır.
--
-- Tersi yapılırsa kod kolonu adıyla yazmaya devam eder: teklif oluşturma /
-- yeniden fiyatlama 42703 ile düşer ve müşteri BOŞ GÖVDELİ bir 500 görür.
-- Ayrıntı: scripts/db/README.md.
--
-- ─── REDDEDER: ÖDENMİŞ TEKLİFTE GÖSTERİLEN KUR KANITI VARSA DURUR ──────────
--
-- İki nesnenin ağırlığı AYNI DEĞİL, o yüzden ret koşulu ince ayarlıdır:
--
--   * `fx_rates` MAKİNE verisidir — TCMB arşivinden (bülten tarihiyle) aynen
--     yeniden üretilebilir. Koşulsuz düşer.
--   * `quotes.fx_snapshot` türetilmiş GÖRÜNÜR: siparişe dönmüş bir teklifin
--     snapshot'ı, müşteriye o gün NE GÖSTERİLDİĞİNİN kanıtıdır ("bana ≈€100
--     dendi" iddiasının tek yazılı cevabı). Onu silmek bir hesap kaydını
--     silmek değil, bir SAVUNMAYI silmektir; bu yüzden böyle bir satır varsa
--     geri alma hiçbir şeye dokunmadan DURUR (ret bir `RAISE EXCEPTION`; blok
--     atomik olarak geri sarılır, tablo ve kolon YERİNDE kalır).
--
-- Ödenmemiş (order_id IS NULL) tekliflerin snapshot'ı KAYIPLI düşer: kolon geri
-- geldiğinde up onu YENİDEN TÜRETMEZ (up hiçbir satır yazmaz). Zararı sınırlı —
-- o teklif yeniden fiyatlandığında güncel kur yeniden donar — ama gitmesi
-- isteniyorsa ÖNCE yanına alın:
--   \copy (SELECT id, number, fx_snapshot FROM quotes WHERE fx_snapshot IS NOT NULL) TO 'quotes_fx_snapshot.csv' CSV HEADER
-- Kolon geri geldikten (up yeniden uygulandıktan) SONRA geri yükleyin:
--   CREATE TEMP TABLE q_fx_backup (id uuid, number text, fx_snapshot jsonb);
--   \copy q_fx_backup FROM 'quotes_fx_snapshot.csv' CSV HEADER
--   UPDATE quotes q SET fx_snapshot = b.fx_snapshot
--     FROM q_fx_backup b WHERE b.id = q.id AND q.fx_snapshot IS NULL;
--
-- Yalnız up'ın EKLEDİĞİ tabloya ve kolona dokunur; `quotes`un öteki kolonları,
-- teklif satırları ve operatör verisi YERİNDE KALIR. `IF EXISTS` sayesinde
-- tekrar çalıştırılabilir; kilit, ret kontrolü, DDL ve journal satırının
-- silinmesi tek işlemde atomiktir.
--
-- ─── DRIZZLE KAYIT SATIRI: KENDİ SATIRINI SİLER ─────────────────────────────
--
-- Silinen satır 0071'in KENDİ etiketidir: `created_at`, journal'daki `when`
-- değeridir (drizzle/meta/_journal.json · idx 71 · tag 0071_fx_rates ·
-- when 1790790800000). "En son eklenen satırı sil" (ORDER BY created_at DESC
-- LIMIT 1) tarifi YASAKTIR: 0071 en yeni olmayabilir ve o tarif başka bir
-- migration'ın kaydını silerdi. `hash` ile silmek de yasaktır — hash dosya
-- İÇERİĞİNİN sha256'sıdır, dosya her düzeltildiğinde değişir ve silme sessizce
-- hiçbir satıra dokunmaz.
--
-- Altındaki bir migration da geri alınacaksa SIRA EN YENİDEN ESKİYE doğrudur:
-- ilk bu dosya, sonra 0070, 0067, 0066, 0065, 0064 … (tam tarif:
-- drizzle/0055_qc_photo_model_revision.down.sql).
DO $$
DECLARE
  used boolean;
BEGIN
  SET LOCAL lock_timeout = '5s';
  IF to_regclass('public.quotes') IS NOT NULL
    AND EXISTS (SELECT 1 FROM pg_attribute
      WHERE attrelid = to_regclass('public.quotes')
        AND attname = 'fx_snapshot' AND attnum > 0 AND NOT attisdropped) THEN
    -- Kolonu düşürmekle "kanıt var mı" okuması arasına kimse girmesin.
    LOCK TABLE public.quotes IN ACCESS EXCLUSIVE MODE;
    SELECT EXISTS (
      SELECT 1 FROM public.quotes WHERE order_id IS NOT NULL AND fx_snapshot IS NOT NULL
    ) INTO used;
    IF used THEN
      RAISE EXCEPTION '0071 rollback refused: ödenmiş tekliflerde gösterilen kur kanıtı var (quotes.fx_snapshot). Yapılacak: kanıtı dışa aktarın (\copy tarifi bu dosyanın başında) ve o tekliflerin kur gösterimini müşteriyle kapatın, sonra bu dosyayı yeniden çalıştırın. Bulmak için: SELECT id, number, order_id FROM quotes WHERE order_id IS NOT NULL AND fx_snapshot IS NOT NULL;';
    END IF;
    ALTER TABLE public.quotes DROP COLUMN IF EXISTS fx_snapshot;
  END IF;
  -- Makine verisi: koşulsuz düşer (TCMB arşivinden yeniden üretilebilir).
  DROP TABLE IF EXISTS public.fx_rates;
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1790790800000;
  END IF;
END $$;
