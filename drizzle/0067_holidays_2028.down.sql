-- 0067 geri alma: 2028 tatillerini takvimden çıkarır.
--
-- Yalnız 0067'nin EKLEDİĞİ on dört tarihi siler; operatörün kendi eklediği
-- tarihler (şirket kapanışı, yerel tatil) ve 2026-2027 tohumu yerinde kalır.
-- Tekrar çalıştırılabilir: ikinci koşuda silinecek bir şey bulamaz.
--
-- Veri kaybı uyarısı: operatör 2028 tarihlerinden BİRİNİ bilerek listeden
-- çıkarmışsa bu script onu geri getirmez; yalnız kalanları siler.
DO $$
DECLARE
  eklenenler text[] := ARRAY[
    '2028-01-01',
    '2028-02-26', '2028-02-27', '2028-02-28',
    '2028-04-23',
    '2028-05-01',
    '2028-05-05', '2028-05-06', '2028-05-07', '2028-05-08',
    '2028-05-19',
    '2028-07-15',
    '2028-08-30',
    '2028-10-29'
  ];
BEGIN
  SET LOCAL lock_timeout = '5s';

  IF to_regclass('public.quote_pricing_settings') IS NOT NULL THEN
    LOCK TABLE public.quote_pricing_settings IN ACCESS EXCLUSIVE MODE;

    UPDATE public.quote_pricing_settings
       SET holidays = COALESCE(
             (
               SELECT jsonb_agg(d ORDER BY d)
                 FROM (
                   SELECT jsonb_array_elements_text(holidays) AS d
                 ) AS mevcut
                WHERE d <> ALL (eklenenler)
             ),
             '[]'::jsonb
           ),
           updated_at = now()
     WHERE id = 1;
  END IF;

  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1790693512063;
  END IF;
END $$;
