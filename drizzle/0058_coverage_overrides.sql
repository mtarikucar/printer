-- 0058 — etki alanı MÜDAHALELERİ (`coverage_overrides`).
--
-- Faz 5 kararı (coverage-model = B): kapsama artık TIKLANMIYOR, HESAPLANIYOR
-- (`services/coverage-plan.ts`). 81 ilin her biri, her malzemede, yarıçap
-- içindeki en yakın UYGUN atölyeye düşer; yarıçapta atölye yoksa il SAHİPSİZ
-- kalır ve uzaktaki bir atölyeye zorlanmaz. Yöneticinin elinde kalan iki söz
-- bu tabloda durur:
--   kind = 'pin'     → bu il, bu malzemede HER ZAMAN `manufacturer_id`in.
--   kind = 'exclude' → bu il, bu malzemede HİÇBİR ZAMAN kapsanmaz.
--
-- NEDEN YENİ TABLO, `manufacturers.coverage_provinces` DEĞİL: o kolon bir
-- ATÖLYENİN beyanıdır, buradaki satır ise bir İLİN sahibidir. Dışlamanın
-- (sahibi OLMAYAN il) atölye satırında karşılığı yok; üstelik hesabın çıktısı
-- oraya yazılsaydı, atölyenin kapasitesi dolduğu ya da adresi değiştiği anda
-- donmuş bir kopya olurdu. Eski kolon YERİNDE KALIR ve bu fazda hiç
-- değişmez: canlı sıralama onu okumaya devam eder, ekran yalnız FARKI gösterir
-- (ranker-rollout = B — hesaplanan planın canlıya geçmesi gölge kararıdır).
--
-- HÜCRE BAŞINA TEK SATIR (`coverage_overrides_il_material_idx`): bir il bir
-- malzemede ya pinlidir ya dışlanmıştır. `kind` TEK sütun olduğu için "hem
-- pinli hem dışlanmış" durumu YAPISAL olarak imkânsızdır — iki ayrı boolean
-- sütun olsaydı bunu yalnız uygulama katmanı engelleyebilirdi. Tekil indeks
-- ayrıca uca `ON CONFLICT` hedefi verir: "önce sil sonra yaz" yapan bir uç,
-- eşzamanlı iki istekte aynı hücrede iki satır bırakabilirdi.
--
-- `material` bir pg enum DEĞİL, `text`. Değer kümesi `figurine_material`
-- enum'undan OKUNUR (services/coverage-plan.ts · COVERAGE_MATERIALS), ama kolon
-- metin kalır ki müdahale tablosu bir enum'a bağlanmasın ve geri alma çifti
-- tabloyu temiz düşürebilsin (kaldırılabilmesi gereken bir şey için pg enum'a
-- değer eklenmez — 0057'deki `trigger` kolonuyla aynı karar).
--
-- `manufacturer_id` ON DELETE cascade: silinmiş bir atölyeye yapılan pin, var
-- olmayan bir sorumludur; satırın yaşaması yöneticiye o ilin kapsandığını
-- söylerdi. Dışlama satırlarında NULL'dur (dışlamanın sahibi yoktur), bu yüzden
-- kolon nullable.
--
-- Kısıtlar CREATE TABLE'ın İÇİNDE: ayrı bir ALTER ... ADD CONSTRAINT idempotent
-- olmazdı (PostgreSQL'de ADD CONSTRAINT IF NOT EXISTS yoktur); tabloyla
-- birlikte tanımlanınca IF NOT EXISTS tamamını kapsar. Kısıt ADI elle yazılıyor
-- ve drizzle'ın anlık görüntüsündeki (meta/0058_snapshot.json) adla birebir
-- aynı; ayrışsalardı sonraki `drizzle-kit generate` farkı "eksik kısıt" sanıp
-- gereksiz bir migration üretirdi.
--
-- `coverage_overrides` CANLIDA OKUNAN BİR TABLO DEĞİL (yalnız admin ekranı ve
-- plan hesabı okur), ama `manufacturers`a FK verdiği için kısa süreli bir kilit
-- ister: kilit hemen alınamazsa deploy'u dakikalarca bekletmek yerine hızlı
-- başarısız olsun.
--
-- Idempotent: bir kez uygulanmış bir veritabanında yeniden çalıştırılabilir.
SET lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "coverage_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"il" text NOT NULL,
	"material" text NOT NULL,
	"kind" text NOT NULL,
	"manufacturer_id" uuid,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "coverage_overrides_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
-- Hücre başına tek müdahale + ucun ON CONFLICT hedefi.
CREATE UNIQUE INDEX IF NOT EXISTS "coverage_overrides_il_material_idx" ON "coverage_overrides" USING btree ("il","material");--> statement-breakpoint
-- Atölye silindiğinde cascade'in tarayacağı yol; ayrıca "bu atölye nerelere
-- pinli?" sorusu (admin ekranı) tam tarama yapmasın.
CREATE INDEX IF NOT EXISTS "coverage_overrides_manufacturer_idx" ON "coverage_overrides" USING btree ("manufacturer_id");
