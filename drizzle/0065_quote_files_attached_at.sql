-- Teklif dosyalarının siparişe BİR KEZ eklendiğini gösteren damga.
-- Yalnızca `quotes`a bir kolon ekler ve kanıtlanabilir satırları geri doldurur;
-- başka tabloya dokunmaz, hiçbir veriyi silmez.
-- Geri alma: 0065_quote_files_attached_at.down.sql (psql ile elle uygulanır).
--
-- NEDEN: `quote-order-files` worker'ının beş dakikalık kurtarma taraması
-- "siparişe bağlı ama HİÇ dosya satırı olmayan teklif" arıyordu. Admin bir model
-- revizyonunu silerken dosya satırlarını VE sürüm başlığını birlikte kaldırıyor,
-- yani BİLEREK silinmiş bir sipariş hiç pişmemiş bir siparişten ayırt
-- edilemiyordu: tarama, adminin sildiği müşteri dosyalarını sessizce geri
-- getiriyordu. Damga bir kez vurulunca silinmez; tarama artık yalnız DAMGASIZ
-- satırı hedefler.
--
-- GERİ DOLGU: kolon eklenirken hâlihazırda bir model dosyası bulunan her teklif
-- siparişi damgalanır — "bu siparişin revizyonu var, pişirmenin işi bitmiş"
-- demek için gereken tek kanıt budur.
--
-- Damga bir DENETİM ZAMANI DEĞİL, bir KAPIDIR: geri dolgu `now()` yazar. Gerçek
-- yükleme zamanı `order_model_revisions.created_at`te duruyor ve o kolon saat
-- dilimsiz (`timestamp`) yazılıyor; onu timestamptz'e çevirmek kapının anlamını
-- değiştirmeden saat kaydırma riski getirirdi.
--
-- Revizyonu bu kolon gelmeden ÖNCE elle silinmiş siparişler DAMGASIZ kalır:
-- geriye dönük kanıt yok. Onlar için runbook kuralı geçerlidir — yerine bir
-- revizyon yükleyin, damga kalıcı olarak vurulur.
SET lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "files_attached_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "quotes" q SET "files_attached_at" = now()
WHERE q."order_id" IS NOT NULL
  AND q."files_attached_at" IS NULL
  AND EXISTS (SELECT 1 FROM "order_model_files" f WHERE f."order_id" = q."order_id");
