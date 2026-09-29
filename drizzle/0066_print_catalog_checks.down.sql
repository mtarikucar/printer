-- 0066 geri alma: baskı kataloğunun aralık kısıtları düşer. Elle uygulanır
-- (psql); journal'da yer almaz.
--
-- KAYIPSIZDIR ve UYGULAMA SIRASI GEREKTİRMEZ. 0064/0065'in geri almalarının
-- tersine burada "önce uygulamayı eski imaja al" adımı YOKTUR: kod hiçbir yerde
-- bir CHECK kısıdını okumuyor, kısıtlar yalnızca YAZIMI denetliyor. Kısıt
-- düştüğünde tek değişen şey, kataloğa aralık dışı bir sayının yazılabilmesidir
-- (yani zod'lu admin rotası tek kapı olarak kalır — 0066 öncesi hâl).
--
-- Yalnız up'ın EKLEDİĞİ kısıtlara dokunur; 0064'ün kısıtları (`..._key_chk`,
-- `..._order_material_chk`, `print_materials_support_factor_chk` (>= 1),
-- `..._colors_chk`, `..._cost_line_kind_chk`, `..._price_type_chk`,
-- `quote_pricing_settings_singleton_chk`) YERİNDE KALIR. Hiçbir satır, kolon ya
-- da tablo silinmez; operatör/müşteri verisine dokunulmaz.
--
-- `IF EXISTS` sayesinde tekrar çalıştırılabilir. Kilit, DDL ve journal satırının
-- silinmesi tek işlemde atomiktir.
--
-- ─── DRIZZLE KAYIT SATIRI: KENDİ SATIRINI SİLER ─────────────────────────────
--
-- 0066 bugün journal'ın EN YENİSİ (when = 1790689912063, watermark). Kaydı
-- silinmezse `drizzle-kit migrate` 0066'yı bir daha uygulamaz — ve daha kötüsü,
-- watermark 0066'da kaldığı için daha küçük `when` taşıyan hiçbir migration da
-- uygulanmaz (bkz. scripts/db/README.md · "Migration ordering"). Altındaki bir
-- migration (0065, 0064, …) geri alınacaksa SIRA EN YENİDEN ESKİYE doğrudur:
-- ilk bu dosya, sonra 0065, sonra 0064.
DO $$
DECLARE
  spec record;
BEGIN
  SET LOCAL lock_timeout = '5s';
  FOR spec IN
    SELECT * FROM (VALUES
      ('public.print_addons', 'print_addons_money_chk'),
      ('public.print_addons', 'print_addons_lead_days_chk'),
      ('public.print_finishes', 'print_finishes_money_chk'),
      ('public.print_finishes', 'print_finishes_lead_days_chk'),
      ('public.print_materials', 'print_materials_support_factor_max_chk'),
      ('public.print_materials', 'print_materials_density_chk'),
      ('public.print_materials', 'print_materials_money_chk'),
      ('public.print_materials', 'print_materials_lead_days_chk'),
      ('public.print_technologies', 'print_technologies_build_mm_chk'),
      ('public.print_technologies', 'print_technologies_money_chk'),
      ('public.print_technologies', 'print_technologies_rate_chk'),
      ('public.print_technologies', 'print_technologies_lead_days_chk'),
      ('public.quote_pricing_settings', 'quote_pricing_settings_money_chk'),
      ('public.quote_pricing_settings', 'quote_pricing_settings_days_chk'),
      ('public.quote_pricing_settings', 'quote_pricing_settings_bps_chk')
    ) AS s(tbl, con)
  LOOP
    IF to_regclass(spec.tbl) IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I',
        to_regclass(spec.tbl)::text, spec.con
      );
    END IF;
  END LOOP;
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1790689912063;
  END IF;
END $$;
