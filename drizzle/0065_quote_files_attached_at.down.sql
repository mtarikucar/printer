-- 0065 geri alma: `quotes.files_attached_at` düşer — yalnız damgalar GERİ
-- TÜRETİLEBİLİR durumdayken. Elle uygulanır (psql); journal'da yer almaz.
--
-- SIRA ZORUNLU — ÖNCE UYGULAMA GERİ ALINIR, SONRA BU DOSYA. Kolon bugünkü ödeme
-- sonrası hattın İÇİNDE, bayrak kontrolü OLMADAN yazılıp okunuyor:
--   1) src/lib/services/quote-order.ts → attachQuoteFilesToOrder (ödenen teklifin
--      dosyalarını siparişe pişiren iş) damgayı YAZAR; kolon yoksa iş 42703 ile
--      düşer ve ödenmiş sipariş dosyasız kalır — üretici basacak dosyayı görmez,
--   2) aynı dosyadaki findQuoteOrdersMissingFiles (beş dakikalık kurtarma
--      taraması) damgayı OKUR; kolon yoksa tarama her turda hata verir.
-- Yordam 0064'ün down'ındakiyle aynıdır (ayrıntı: scripts/db/README.md):
-- (1) app + worker imajlarını 0065 ÖNCESİ commit'e al, (2) ödenmiş bir siparişin
-- dosya pişirmesini doğrula, (3) ancak ondan sonra bu dosyayı çalıştır.
--
-- RET KAPISI: damga, kolon geri geldiğinde up'ın geri dolgusuyla YENİDEN
-- türetilebiliyorsa (siparişin model dosyası hâlâ duruyorsa) düşürmek kayıpsızdır.
-- Türetilemeyen tek damga, dosyaları eklenmiş AMA revizyonu sonradan elle
-- SİLİNMİŞ siparişin damgasıdır. Onu düşürmek tam da bu migration'ın kapattığı
-- hatayı geri getirir: kurtarma taraması o siparişi "hiç pişmemiş" sayar ve
-- adminin sildiği müşteri dosyalarını yeniden yazar. Böyle bir satır varsa geri
-- alma REDDEDİLİR ve hiçbir şey düşmez.
--
-- İstisna gerçekten isteniyorsa damgaları ÖNCE yanına al:
--   \copy (SELECT id, number, order_id, files_attached_at FROM quotes WHERE files_attached_at IS NOT NULL) TO 'quotes_files_attached_at.csv' CSV HEADER
-- Kolon geri geldikten (up yeniden uygulandıktan) SONRA geri yükle:
--   CREATE TEMP TABLE q_stamp_backup (id uuid, number text, order_id uuid, files_attached_at timestamptz);
--   \copy q_stamp_backup FROM 'quotes_files_attached_at.csv' CSV HEADER
--   UPDATE quotes q SET files_attached_at = b.files_attached_at
--     FROM q_stamp_backup b WHERE b.id = q.id AND q.files_attached_at IS NULL;
--
-- Tekrar çalıştırılabilir (IF EXISTS) ve yalnız up'ın eklediği kolona dokunur;
-- müşteri/operatör verisine dokunmaz. Kilit, ret kontrolü, DDL ve journal
-- satırının silinmesi tek işlemde atomiktir.
DO $$
DECLARE
  used boolean;
BEGIN
  SET LOCAL lock_timeout = '5s';
  IF to_regclass('public.quotes') IS NOT NULL
    AND EXISTS (SELECT 1 FROM pg_attribute
      WHERE attrelid = to_regclass('public.quotes')
        AND attname = 'files_attached_at' AND attnum > 0 AND NOT attisdropped) THEN
    LOCK TABLE public.quotes IN ACCESS EXCLUSIVE MODE;
    IF to_regclass('public.order_model_files') IS NULL THEN
      -- Kısmen kurulmuş şema: türetmenin dayanağı yok, damgalıların HEPSİ reddeder.
      SELECT EXISTS (SELECT 1 FROM public.quotes WHERE files_attached_at IS NOT NULL) INTO used;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM public.quotes q
        WHERE q.files_attached_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.order_model_files f WHERE f.order_id = q.order_id
          )
      ) INTO used;
    END IF;
    IF used THEN
      RAISE EXCEPTION
        '0065 rollback refused: quotes.files_attached_at holds stamps the up cannot re-derive (model revision deleted by hand)';
    END IF;
    ALTER TABLE public.quotes DROP COLUMN IF EXISTS files_attached_at;
  END IF;
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1790686312063;
  END IF;
END $$;
