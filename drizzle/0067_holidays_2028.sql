-- Resmî tatil takvimini 2028 sonuna uzatır.
--
-- NEDEN GEREKLİ: 0064'ün tohumladığı takvim 2027-10-29'da bitiyor. İş günü
-- hesabı (src/lib/config/business-days.ts) listede olmayan her hafta içi günü
-- ÇALIŞMA GÜNÜ sayar, yani 2027-11-01'den itibaren teslim tarihleri sessizce
-- iyimserleşir ve üreticinin SLA'sı bu yanlış tarihe göre ölçülür.
--
-- KAYNAK: Diyanet İşleri Başkanlığı 2028 dini günler takvimi
-- (vakithesaplama.diyanet.gov.tr/icerik.php?icerik=185, 2026-09-29'da okundu):
--   Ramazan Bayramı 26-27-28 Şubat 2028 (arife 25 Şubat)
--   Kurban Bayramı  5-6-7-8 Mayıs 2028  (arife 4 Mayıs)
-- Millî bayramlar kanunla sabittir. Arife yarım günleri listeye GİRMEZ: iş
-- günü hesabı bir günü ya tam çalışma ya tam tatil sayar ve arifeyi tatil
-- saymak teslim tarihini gereksiz yere uzatırdı.
--
-- NEDEN EKLEME (ezme değil): `quote_pricing_settings` admin panelinden
-- düzenlenebilir. Operatör listeye kendi tatilini (şirket kapanışı, yerel
-- tatil) eklemiş olabilir; koşulsuz bir yazım onu sessizce silerdi. Aşağıdaki
-- ifade mevcut listeyle birleşir, tekilleştirir ve sıralar — zaten eklenmiş
-- tarihleri ikinci kez eklemez, yani tekrar çalıştırmak güvenlidir.
SET lock_timeout = '5s';
--> statement-breakpoint
UPDATE "quote_pricing_settings"
   SET "holidays" = (
         SELECT jsonb_agg(DISTINCT d ORDER BY d)
           FROM (
             SELECT jsonb_array_elements_text("holidays") AS d
             UNION
             SELECT unnest(ARRAY[
               '2028-01-01',
               '2028-02-26', '2028-02-27', '2028-02-28',
               '2028-04-23',
               '2028-05-01',
               '2028-05-05', '2028-05-06', '2028-05-07', '2028-05-08',
               '2028-05-19',
               '2028-07-15',
               '2028-08-30',
               '2028-10-29'
             ])
           ) AS birlesik
       ),
       "updated_at" = now()
 WHERE "id" = 1;
