-- STEP biçimi: `quote_parts.source_format` listesi dörde çıkar ve STEP'in birimi
-- mm'ye KİLİTLENİR.
--
-- Yalnızca iki adlandırılmış CHECK değişir: hiçbir tablo, kolon, satır ya da
-- tohum yok; para taşımaz. Geri alma: 0070_step_format.down.sql (psql ile elle
-- uygulanır — ama SIRA vardır, o dosyanın başlığını okumadan çalıştırmayın).
--
-- NEDEN pg enum DEĞİL: kolon `text` + adlandırılmış CHECK (ev kuralı, gerekçesi
-- `src/lib/db/schema.ts`'in "Anlık teklif motoru" blok başlığında). Bir CHECK'i
-- düşürüp yeniden kurmak GERİ ALINABİLİR; `ALTER TYPE ... ADD VALUE` olmazdı.
--
-- Liste `src/lib/config/quote-types.ts`teki `QUOTE_SOURCE_FORMATS`ten türer
-- (`schema.ts` · `quoteInList`). İkisi ayrışırsa uygulama `step` yazmaya kalkar,
-- veritabanı 23514 ile reddeder ve müşteri boş gövdeli bir 500 görür; eşitlik bu
-- yüzden `scripts/test-quote-step-migration-db.ts` tarafından kaynak üzerinden
-- de sınanır.
--
-- ─── NEDEN BİRİM KİLİDİ (quote_parts_step_units_chk) ────────────────────────
--
-- STEP dosyası kendi birimini KENDİ taşır (`step_mesh.py` onu okuyup mm'ye
-- uygular), oysa STL/OBJ taşımaz ve müşteri birimi elle seçer. Birim STEP'te de
-- açık kalsaydı "cm" seçmek parçayı 10× büyütür, hacmi 1000× şişirir ve fiyatı
-- 1000× yanlışlardı. Bu bir PARA kapısıdır: yalnız ekranda kapatmak yetmez,
-- çünkü ikinci bir yazan (bir bakım betiği, elle bir UPDATE, ileride yeni bir
-- uç) ekranı atlar. Kilit bu yüzden veritabanında da durur — savunma DERİNLİĞİ.
--
-- ─── NEDEN `NOT VALID` KULLANILMIYOR ───────────────────────────────────────
--
-- 0066'nın gerekçesi burada GEÇERSİZ: orada kısıtlar mevcut satırları REDDEDEBİLİR
-- (yönetici her sayıyı değiştirebiliyordu), burada ikisi de reddedemez. Liste
-- GENİŞLİYOR, yani bugün geçerli olan her satır yarın da geçerli; birim kilidi de
-- `source_format = 'step'` satırı olmadığı için (biçim henüz yazılamıyor) hiçbir
-- satıra dokunmaz. Doğrulama tarama olarak ucuz ve düşme riski yok, o yüzden
-- kısıt DOĞRULANMIŞ eklenir: doğrulanmamış bir kısıt bırakmak, ileride sessizce
-- meşrulaşan bir satır demekti.
SET lock_timeout = '5s';
--> statement-breakpoint
DO $$
BEGIN
  SET LOCAL lock_timeout = '5s';
  IF to_regclass('public.quote_parts') IS NULL THEN
    RAISE EXCEPTION '0070: public.quote_parts yok — önce 0064_instant_quotes uygulanmalı.';
  END IF;
  -- Kısıt takası ile yazıcılar arasına kimse girmesin. `ALTER TABLE` bu kilidi
  -- kendiliğinden alır; açıkça almak pencereyi tek bir yere toplar.
  LOCK TABLE public.quote_parts IN ACCESS EXCLUSIVE MODE;
  -- Tekrar çalıştırılabilir: `IF EXISTS` ile düşür, sonra kur.
  ALTER TABLE public.quote_parts DROP CONSTRAINT IF EXISTS quote_parts_source_format_chk;
  ALTER TABLE public.quote_parts ADD CONSTRAINT quote_parts_source_format_chk
    CHECK (source_format IN ('stl', 'obj', '3mf', 'step'));
  ALTER TABLE public.quote_parts DROP CONSTRAINT IF EXISTS quote_parts_step_units_chk;
  ALTER TABLE public.quote_parts ADD CONSTRAINT quote_parts_step_units_chk
    CHECK (source_format <> 'step' OR units = 'mm');
END $$;
