-- 0055 — QC fotoğrafını, GERÇEKTEN BASILAN model sürümüne bağlar.
--
-- Bugüne kadar `qc_photos` yalnız bir TUR numarası taşıyordu. Faz 2'nin
-- late-model-upload kararıyla admin, iş üretimdeyken yeni bir model sürümü
-- yükleyebiliyor: bu durumda QC sıfırlanıyor (tur artar, bekleyen fotoğraflar
-- reddedilir, üretici `printing`e döner). Ama tur numarası "hangi modelin
-- baskısı" sorusunu cevaplamıyor — üretici yeni turda da ESKİ baskının
-- fotoğraflarını yükleyebilir; o baskı QC'den geçerse ESKİ model kargoya
-- çıkar ve hakediş oradan tahakkuk eder.
--
-- `model_revision`, fotoğrafın çekildiği baskının `order_model_revisions`
-- sürüm numarasıdır. NULL kalabilir: bu migration'dan ÖNCEKİ satırlar, hiç
-- model sürümü olmayan (elle açılan) siparişler ve aşağıdaki BELİRSİZ eşleme
-- halleri damgasızdır. Damgasız satır KANIT SAYILMAZ: uygulama onu "eski değil"
-- diye değil, "hangi baskı olduğu bilinmiyor" diye okur (bkz.
-- qcRoundPrintProof). Siparişin tek sürümü varsa bu belirsizlik zararsızdır
-- (ortada daha eski bir baskı yoktur) ve geçmiş siparişler kilitlenmez; birden
-- çok sürümü varsa tur kendiliğinden onaylanmaz, admin gerekçe yazarak
-- onaylar.
--
-- NULL varsayılanlı ADD COLUMN, PostgreSQL 11+'ta tabloyu YENİDEN YAZMAZ:
-- yalnız katalog güncellenir. Yine de kısa süreli ACCESS EXCLUSIVE kilit
-- ister — kilit alınamazsa hızlı başarısız olsun.
-- ─── BU DOSYA, 0055'İ ZATEN ALMIŞ BİR VERİTABANINDA ÖLÜ METİNDİR ──────────
--
-- Yukarıdaki backfill kuralı bir kez DÜZELTİLDİ (eski kural zaman çizgisinden
-- sürüm türetiyordu). Düzeltme, 0055'i HENÜZ almamış veritabanlarına ulaşır;
-- almış olanlara ULAŞMAZ. Sebep migrator'ın karşılaştırmasıdır: uygulanmış
-- migration'ları yalnız journal'daki `when` değeriyle tanır
-- (drizzle-orm/pg-core/dialect.js · "order by created_at desc limit 1" +
-- `lastDbMigration.created_at < migration.folderMillis`). Dosyanın sha256
-- HASH'i kayda yazılır ama BİR DAHA OKUNMAZ; içerik değişince kayıt "eski"
-- sayılmaz, dosya yeniden çalıştırılmaz. QA veritabanında bu fark gözle
-- görülür: kayıtlı hash bb871f45… iken dosyanın hash'i bambaşkadır ve 0055
-- yeniden uygulanmamıştır.
--
-- SONUÇ: bu backfill'in doğru olması bir GÜVENCE DEĞİLDİR. Uygulama ona
-- DAYANMAZ — dayanamaz da, çünkü 0055'i almış bir veritabanında satırlar
-- backfill'in bugünkü kuralıyla değil, o günkü kuralıyla (ya da hiç) damgalıdır.
-- Kapıyı tutan şey uygulamanın kendi kuralıdır: `qcRoundPrintProof`
-- (src/lib/config/order-model-policy.ts) DAMGASIZ bir fotoğrafı "eski değil"
-- saymaz, "bilinmiyor" sayar ve siparişin birden çok sürümü varsa turu
-- KENDİLİĞİNDEN onaylatmaz. Bu yüzden backfill'in az damgalaması (ya da hiç
-- damgalamaması) güvenliği bozmaz; yalnız admin'e elle gerekçe yazdırır.
-- Damganın YANLIŞ olması ise bozardı — kural bu yüzden yalnız kanıtlanabilir
-- damgayı yazar.
--
SET lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "qc_photos" ADD COLUMN IF NOT EXISTS "model_revision" integer;--> statement-breakpoint
-- ─── Backfill: TAHMİN ETMEZ, yalnız KANITLAYABİLDİĞİNİ damgalar ────────────
--
-- Bu backfill bir zamanlar "fotoğraf tarihinden önceki en büyük sürüm"ü
-- (max(revision) WHERE created_at <= photo.created_at) yazıyordu. O kural
-- ZAMAN ÇİZGİSİNİ okuyordu, oysa damganın cevapladığı soru "o an saat kaçtı"
-- değil, "elindeki baskı hangi modelden" sorusudur. İkisi ayrışır: üretici,
-- yeni sürüm yüklendikten SANİYELER sonra ESKİ baskının fotoğrafını
-- yükleyebilir — uygulamanın o satıra yazdığı damga (1) bilerek zaman
-- çizgisinin ima ettiğinden (2) DÜŞÜKTÜR. Kolon zaten tam olarak bu farkı
-- kaydetmek için var.
--
-- Eski kural bu yüzden geri alma + yeniden uygulama turunda QA veritabanında
-- 16 damganın 4'ünü 1'den 2'ye YÜKSELTTİ. Yükselen damga sessiz bir felakettir:
-- `qcPhotosMatchCurrentRevision` damgayı ancak `damga >= geçerli sürüm` ise
-- geçirir, yani 2'ye yükseltilmiş satır, qc-approve'un 409
-- `stale_model_revision` ile reddettiği BAYAT turu QC'den geçirir; eski modelin
-- baskısı kargoya çıkar ve hakediş oradan tahakkuk eder.
--
-- Bu yüzden kural şudur: yalnız KANITLANABİLİR damga yazılır — siparişin İLK
-- sürümü (revision 1), ve yalnız fotoğrafın çekildiği anda ondan başka sürüm
-- YOKKEN. Böyle bir damga hiçbir şeyin kilidini açamaz: 1 damgası ancak
-- siparişin geçerli sürümü de 1 iken geçer, yani ortada daha eski bir baskı
-- YOKTUR. Kısacası bu backfill QC'yi damgasız bırakmaya göre yalnız
-- SIKILAŞTIRABİLİR, asla gevşetemez.
--
-- Damgasız bırakılan (belirsiz) haller:
--   a) fotoğraf anında daha yeni bir sürüm zaten vardı — hangi baskı olduğu
--      kayıttan çıkarılamaz (yukarıdaki 4 satırın hali),
--   b) siparişin 1 numaralı sürümü kayıtlı değil (silinmiş ya da hiç
--      arşivlenmemiş) — zaman çizgisinin en eski noktası bilinmiyor, "daha
--      eskisi yok" iddiası dayanaksız kalır,
--   c) fotoğraf, 1 numaralı sürümden sonraki 10 dakikanın içinde — reçine
--      baskı o sürede ne üretilir ne fotoğraflanır, yani o fotoğraf sürüm
--      kaydından ÖNCEKİ bir baskıya aittir; onu da hiçbir satır adlandıramaz.
--      (Pencere ayrıca saat kayması ve aynı isteğin yarışını kapsar.)
--
-- Idempotent: `model_revision IS NULL` süzgeci sayesinde uygulamanın yazdığı
-- ya da önceki çalıştırmanın bıraktığı damgalar ASLA yeniden yazılmaz; kural
-- yalnız kayıtlı zaman damgalarını ve sürüm numaralarını okur (now() / random()
-- yok), yani ikinci çalıştırma aynı cevabı üretir ve hiçbir satırı değiştirmez.
UPDATE "qc_photos" p
SET "model_revision" = 1
FROM "order_model_revisions" first_rev
WHERE p."model_revision" IS NULL
  AND first_rev."order_id" = p."order_id"
  AND first_rev."revision" = 1
  AND p."created_at" >= first_rev."created_at" + interval '10 minutes'
  AND NOT EXISTS (
    SELECT 1
    FROM "order_model_revisions" newer
    WHERE newer."order_id" = p."order_id"
      AND newer."revision" > 1
      AND newer."created_at" <= p."created_at"
  );
