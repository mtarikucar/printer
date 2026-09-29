-- Baskı kataloğunun para / oran / gün kolonlarına ARALIK kısıtları.
--
-- Yalnızca CHECK ekler: hiçbir kolon, satır ya da veri değişmez. Geri alma:
-- 0066_print_catalog_checks.down.sql (psql ile elle uygulanır).
--
-- NEDEN: bu tablolardaki sayılar doğrudan müşteriye çıkan fiyata giriyor ve
-- bugünkü tek yazan zod'lu admin rotası (`src/lib/validators/print-catalog.ts`
-- · `CATALOG_LIMITS`). Şema bir KOD kapısıdır: ikinci bir yazan (elle bir
-- UPDATE, bir bakım betiği, ileride yeni bir uç) onu atlar ve o gün kataloğa
-- giren "yüzde yerine baz puan" ya da eksi bir fiyat, ekranda fark edilmeyen
-- ama yayına çıkan bir fiyat hatası olur. Sınırlar bu yüzden veritabanında da
-- durur — savunma DERİNLİĞİ, zod'un yerine geçen bir şey değil.
--
-- SAYILAR `CATALOG_LIMITS` İLE AYNI olmalı ve DB daha DAR olmamalı: panelin
-- kabul ettiği bir değeri veritabanı reddederse yönetici ekranda anlamadığı bir
-- 500 görür. Eşitlik `scripts/test-quote-admin-catalog.ts` tarafından kaynak
-- üzerinden, kısıtların davranışı `scripts/test-quote-admin-catalog-db.ts`
-- tarafından gerçek satırlarla sınanır.
--
-- ─── NEDEN `NOT VALID` + `VALIDATE CONSTRAINT` ──────────────────────────────
--
-- Katalog ÜRETİMDE ve yönetici her sayıyı değiştirebiliyor; bu yüzden kısıt
-- eklenirken mevcut satırların uyumlu olduğu VARSAYILAMAZ. İki seçenek vardı:
--
--   (a) Düz `ADD CONSTRAINT`: tabloyu tarar ve uyumsuz TEK bir satır varsa
--       migration'ı düşürür. Migration tek işlem olduğu için dağıtım da düşer
--       (`deploy.yml` · migrate servisi) ve hatanın tek söylediği şey kısıdın
--       adıdır: hangi satır, hangi kolon, hangi değer — hiçbiri yok. Yani
--       hijyen amaçlı bir migration, canlı dağıtımı kilitleyebilir.
--   (b) `NOT VALID` ile ekleyip sonra `VALIDATE CONSTRAINT`: ekleme mevcut
--       satırlara HİÇ bakmaz (tarama yok, uzun kilit yok) ama o andan sonraki
--       HER yazımı (INSERT ve UPDATE) reddeder — yani kapı aynı dakikada
--       kapanır. Doğrulama ayrı bir adımdır ve düşerse yalnız KENDİSİ düşer.
--
-- (b) seçildi ve doğrulama adımı `check_violation`u YAKALAR: uyumsuz satır
-- varsa kısıt `NOT VALID` kalır, migration YEŞİL biter ve kısıdın adı WARNING
-- olarak yazılır. Böylece üç şey birden sağlanır: dağıtım düşmez, yeni yazımlar
-- yine de reddedilir ve eski satır sessizce meşrulaşmaz.
--
-- WARNING'e GÜVENİLMEZ: `drizzle-kit migrate` sunucu bildirimlerini basmaz, yani
-- uyarı dağıtım günlüğünde görünmeyebilir (psql ile elle uygulandığında görünür).
-- Tek güvenilir işaret aşağıdaki sorgudur ve dağıtım kontrol listesinde adım
-- olarak durur (scripts/db/README.md · "Deploying 0064: operator checklist").
--
-- Doğrulanmamış kalan kısıt görünürdür — dağıtımdan sonra bakılacak yer:
--   SELECT t.relname, c.conname FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
--    WHERE c.contype = 'c' AND NOT c.convalidated ORDER BY 1,2;
-- Uyumsuz satırı bulmak için kısıdın kendi ifadesi kullanılır, örn.:
--   SELECT id, key, density_g_cm3 FROM print_materials WHERE NOT (density_g_cm3 BETWEEN 0.5 AND 3);
-- (Kısıdın ifadesi: `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = '<ad>'`.)
-- Değer panelden düzeltildikten sonra kısıt elle doğrulanır:
--   ALTER TABLE <tablo> VALIDATE CONSTRAINT <ad>;
--
-- DİKKAT: doğrulanmamış bir kısıt, UYUMSUZ SATIRIN KENDİSİNİ de kilitler —
-- UPDATE satırı yeniden denetlediği için o satır, değeri düzeltilmeden
-- düzenlenemez (panelde beklenmeyen 500). Bu yüzden WARNING görülür görülmez
-- değer düzeltilmelidir.
SET lock_timeout = '5s';
--> statement-breakpoint
-- 1) Kısıtları `NOT VALID` ekle. Tekrar çalıştırılabilir: adı zaten duran kısıt
--    atlanır, tablosu yoksa (kısmi şema) satır sessizce geçilir.
DO $$
DECLARE
  spec record;
BEGIN
  SET LOCAL lock_timeout = '5s';
  FOR spec IN
    SELECT * FROM (VALUES
      ('public.print_addons', 'print_addons_money_chk',
       '"print_addons"."price_kurus" BETWEEN 0 AND 10000000'),
      ('public.print_addons', 'print_addons_lead_days_chk',
       '"print_addons"."lead_days_extra" BETWEEN 0 AND 60'),
      ('public.print_finishes', 'print_finishes_money_chk',
       '"print_finishes"."fixed_kurus" BETWEEN 0 AND 10000000 AND "print_finishes"."per_cm2_kurus" BETWEEN 0 AND 10000000'),
      ('public.print_finishes', 'print_finishes_lead_days_chk',
       '"print_finishes"."lead_days_extra" BETWEEN 0 AND 60'),
      ('public.print_materials', 'print_materials_support_factor_max_chk',
       '"print_materials"."support_factor" <= 3'),
      ('public.print_materials', 'print_materials_density_chk',
       '"print_materials"."density_g_cm3" BETWEEN 0.5 AND 3'),
      ('public.print_materials', 'print_materials_money_chk',
       '"print_materials"."price_kurus_per_gram" BETWEEN 0 AND 10000000'),
      ('public.print_materials', 'print_materials_lead_days_chk',
       '"print_materials"."lead_days_extra" BETWEEN 0 AND 60'),
      ('public.print_technologies', 'print_technologies_build_mm_chk',
       '"print_technologies"."build_x_mm" BETWEEN 10 AND 2000 AND "print_technologies"."build_y_mm" BETWEEN 10 AND 2000 AND "print_technologies"."build_z_mm" BETWEEN 10 AND 2000'),
      ('public.print_technologies', 'print_technologies_money_chk',
       '"print_technologies"."setup_fee_kurus" BETWEEN 0 AND 10000000 AND "print_technologies"."machine_rate_kurus_per_hour" BETWEEN 0 AND 10000000 AND "print_technologies"."min_unit_price_kurus" BETWEEN 0 AND 10000000'),
      ('public.print_technologies', 'print_technologies_rate_chk',
       '"print_technologies"."throughput_cm3_per_hour" > 0 AND "print_technologies"."throughput_cm3_per_hour" <= 100000 AND "print_technologies"."height_hours_per_mm" BETWEEN 0 AND 10 AND "print_technologies"."min_wall_mm" > 0 AND "print_technologies"."min_wall_mm" <= 50 AND "print_technologies"."min_feature_mm" > 0 AND "print_technologies"."min_feature_mm" <= 50 AND "print_technologies"."shell_mm" BETWEEN 0 AND 50'),
      ('public.print_technologies', 'print_technologies_lead_days_chk',
       '"print_technologies"."base_lead_days" BETWEEN 1 AND 60'),
      ('public.quote_pricing_settings', 'quote_pricing_settings_money_chk',
       '"quote_pricing_settings"."min_order_kurus" BETWEEN 0 AND 10000000 AND "quote_pricing_settings"."max_auto_total_kurus" BETWEEN 0 AND 10000000'),
      ('public.quote_pricing_settings', 'quote_pricing_settings_days_chk',
       '"quote_pricing_settings"."quote_valid_days" BETWEEN 1 AND 365 AND "quote_pricing_settings"."retention_days_after_expiry" BETWEEN 1 AND 3650'),
      -- Baz puanlar jsonb'nin İÇİNDE durur. `jsonb_path_exists` DEĞİŞMEZ
      -- (immutable) olduğu için CHECK'te kullanılabilir; alt sorgu kullanılamaz.
      -- Tek aralık (0–30000) iki listeyi de kapsar: adet indirimi baz puanı ve
      -- teslim kademesi çarpanı.
      ('public.quote_pricing_settings', 'quote_pricing_settings_bps_chk',
       'NOT jsonb_path_exists("quote_pricing_settings"."qty_breaks", ''$[*].discountBps ? (@ < 0 || @ > 30000)'') AND NOT jsonb_path_exists("quote_pricing_settings"."lead_tiers", ''$[*].multiplierBps ? (@ < 0 || @ > 30000)'')')
    ) AS s(tbl, con, expr)
  LOOP
    IF to_regclass(spec.tbl) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = to_regclass(spec.tbl) AND conname = spec.con
      ) THEN
      EXECUTE format(
        'ALTER TABLE %s ADD CONSTRAINT %I CHECK (%s) NOT VALID',
        to_regclass(spec.tbl)::text, spec.con, spec.expr
      );
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
-- 2) Doğrulamayı DENE. Uyumsuz satır migration'ı düşürmez: kısıt `NOT VALID`
--    kalır (yeni yazımları yine reddeder) ve operatör adıyla uyarılır.
DO $$
DECLARE
  con record;
  pending text[] := '{}';
BEGIN
  SET LOCAL lock_timeout = '5s';
  FOR con IN
    SELECT c.conname, c.conrelid::regclass::text AS relname
    FROM pg_constraint c
    WHERE c.contype = 'c'
      AND NOT c.convalidated
      AND c.conrelid IN (
        to_regclass('public.print_technologies'),
        to_regclass('public.print_materials'),
        to_regclass('public.print_finishes'),
        to_regclass('public.print_addons'),
        to_regclass('public.quote_pricing_settings')
      )
    ORDER BY c.conname
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', con.relname, con.conname);
    EXCEPTION WHEN check_violation THEN
      pending := pending || (con.relname || '.' || con.conname);
    END;
  END LOOP;
  IF array_length(pending, 1) > 0 THEN
    RAISE WARNING '0066: uyumsuz satır yüzünden DOĞRULANMADAN eklenen kısıtlar: %. Yeni yazımlar zaten reddediliyor; katalogdaki değeri /admin/baski-katalogu ekranından düzeltip "ALTER TABLE <tablo> VALIDATE CONSTRAINT <ad>" ile doğrulayın (ayrıntı: drizzle/0066_print_catalog_checks.sql).',
      array_to_string(pending, ', ');
  END IF;
END $$;
