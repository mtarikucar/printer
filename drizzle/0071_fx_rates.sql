-- Döviz GÖSTERİMİ: TCMB günlük kur tablosu + teklifin dondurduğu kur kümesi.
--
-- Bir tablo (`fx_rates`) ve `quotes`a bir nullable kolon (`fx_snapshot`) ekler.
-- Hiçbir satır YAZMAZ, hiçbir kolonu değiştirmez, hiçbir veriyi silmez; tohum
-- taşımaz. Geri alma: 0071_fx_rates.down.sql (psql ile elle uygulanır).
--
-- ─── YALNIZ GÖSTERİM — BU MIGRATION'IN BİRİNCİ KURALI ──────────────────────
--
-- Bağlayıcı her tutar, saklanan her PARA kolonu ve tahsil edilen her kuruş
-- TÜRK LİRASIDIR. Bu tablodaki kur, ekranda ₺ tutarının YANINDA "≈ <döviz>"
-- olarak gösterilen YAKLAŞIK bir ikinci kolonu besler; hiçbir tutar döviz
-- cinsinden tahsil edilmez, iade edilmez, faturalanmaz. Gerekçe bir ürün
-- tercihi değil: 32 Sayılı Karar m.4/g + 2008-32/34 Tebliğ m.8, Türkiye'de
-- yerleşikler arası satış sözleşmesinde bedelin TL olmasını ZORUNLU kılar.
-- (Aynı cümle `src/lib/config/quote-currency.ts` dosya başlığında.)
--
-- Bu yüzden `fx_rates`te kuruş kolonu YOKTUR ve `quotes.fx_snapshot` bir PARA
-- kolonu değil, müşteriye NE GÖSTERİLDİĞİNİN kanıtıdır.
--
-- ─── NEDEN AYRI TABLO (`quote_pricing_settings`e KONULAMAZ) ────────────────
--
-- `catalogUpdatedAt()` (src/lib/services/quote-catalog.ts) o tablonun
-- `updated_at`ini `greatest(...)` içine alıyor ve `loadPresentedQuote` bunu
-- `quotes.snapshot_taken_at` ile karşılaştırıp `catalogChangedSinceSnapshot`
-- bayrağını üretiyor. Kur GÜNLÜK yazıldığı için o satıra dokunan bir tasarım
-- her sabah AÇIK HER TEKLİFTE "Katalog güncellendi — yeniden fiyatla" bandını
-- yakardı. Aynı sebeple `catalogUpdatedAt()`ın `greatest(...)` listesine
-- `fx_rates` EKLENMEZ.
--
-- Kur, `quotes.pricing_snapshot`ın İÇİNE de girmez: o sürümlenmiş bir KATALOG
-- sözleşmesidir (`PricingSnapshot`, `version: 1`) ve `quote-seed.ts` ile
-- `test-quote-core.ts` onun şekline bakar. Kur bir katalog satırı değil, bir
-- gün sabitidir.
--
-- ─── NEDEN pg enum DEĞİL ───────────────────────────────────────────────────
--
-- `currency` ve `source` `text` + adlandırılmış CHECK (ev kuralı, gerekçesi
-- `src/lib/db/schema.ts`in "Anlık teklif motoru" blok başlığında): bir CHECK'i
-- düşürüp yeniden kurmak GERİ ALINABİLİR, `ALTER TYPE ... ADD VALUE` olmazdı.
-- Para birimi listesi `src/lib/config/quote-types.ts`teki `FX_CURRENCIES`ten
-- türer (`schema.ts` · `quoteInList`); ikisi ayrışırsa uygulama katalog dışı bir
-- birim yazmaya kalkar, veritabanı 23514 ile reddeder ve müşteri boş gövdeli bir
-- 500 görür. Eşitlik bu yüzden `scripts/test-fx-migration-db.ts` tarafından
-- kaynak üzerinden de sınanır.
--
-- `micro_try_per_unit` MİKRO-TRY tamsayısıdır (1 birim döviz = kaç ×1e-6 ₺):
-- `double precision` bir kuru saklamak, aynı kurun iki turda farklı bir döviz
-- rakamı üretmesi demekti. `bulletin_unit` (TCMB `Unit`) kanıt olarak durur —
-- bölme çekme turunda yapılır, burada saklanan zaten BİR birimin kurudur.
--
-- ─── IDEMPOTENT ────────────────────────────────────────────────────────────
--
-- `IF NOT EXISTS` dörtlüsü: yarı kalmış bir turdan sonra yeniden koşabilir.
-- `public.` ÖNEKİ ZORUNLU: round-trip testi şemayı tek kullanımlık bir isim
-- alanına taşımak için `public.` → `"<ns>".` yerine koyma yapıyor; önek
-- yazılmazsa test izolasyonu çöker ve test QA'nın gerçek şemasına yazar.
SET lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."fx_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"currency" text NOT NULL,
	"bulletin_date" date NOT NULL,
	"micro_try_per_unit" bigint NOT NULL,
	"bulletin_unit" integer DEFAULT 1 NOT NULL,
	"source" text DEFAULT 'tcmb' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rates_currency_chk" CHECK ("fx_rates"."currency" IN ('EUR', 'USD', 'GBP')),
	CONSTRAINT "fx_rates_source_chk" CHECK ("fx_rates"."source" IN ('tcmb')),
	CONSTRAINT "fx_rates_rate_chk" CHECK ("fx_rates"."micro_try_per_unit" > 0),
	CONSTRAINT "fx_rates_unit_chk" CHECK ("fx_rates"."bulletin_unit" > 0)
);
--> statement-breakpoint
-- Aynı bülten tarihi için ikinci yazım: çekme turu `ON CONFLICT DO NOTHING`
-- diyebilsin (hafta sonu / tatil aynı bülteni tekrar getirir).
CREATE UNIQUE INDEX IF NOT EXISTS "fx_rates_currency_date_uq" ON "public"."fx_rates" USING btree ("currency","bulletin_date");
--> statement-breakpoint
-- "En yeni bülten" okuması sıcak yoldur (teklif açılışı kur dondurur).
CREATE INDEX IF NOT EXISTS "fx_rates_recent_idx" ON "public"."fx_rates" USING btree ("bulletin_date" DESC NULLS LAST);
--> statement-breakpoint
-- Nullable: bugünkü her teklif NULL ile yaşar (bayrak kapalı → kur donmaz).
ALTER TABLE "public"."quotes" ADD COLUMN IF NOT EXISTS "fx_snapshot" jsonb;
