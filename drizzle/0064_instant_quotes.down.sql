-- 0064 geri alma: yalnızca HİÇ kullanılmamış anlık teklif şemasını kaldırır.
-- Tek bir teklif, ödeme kaydı ya da admin katalog düzenlemesi varsa reddeder;
-- müşteri ve operatör verisi asla silinmez. Katalog tohumu tablosuyla gider.
-- Kilitler, kontroller, DDL ve journal satırının silinmesi tek işlemde atomiktir.
-- Elle uygulanır (psql); journal'da yer almaz. Daha yeni migration'lar önce geri alınır.
--
-- SIRA ZORUNLU — ÖNCE UYGULAMA GERİ ALINIR, SONRA BU DOSYA. Bu tablolar bugünkü
-- sipariş hattının içindedir ve beş yerde bayrak kontrolü OLMADAN okunur:
--   1) src/lib/services/order-confirm.ts → linkQuoteToOrderTx (ödeme işlemi içinde,
--      HER custom sipariş için) — atarsa PayTR webhook'u 500 verir, para çekilmiş
--      sipariş `paid`ta donar,
--   2) src/lib/services/manufacturer-assign.ts → loadPlacementFacts → quoteOrderRequirements,
--   3) src/lib/services/manufacturer-assignment.ts sıralayıcısı (otomatik atama),
--   4) src/app/api/admin/orders/[id]/approve/route.ts (her sipariş için `quotes` okur),
--   5) src/app/manufacturer/orders/[id]/page.tsx → `productionGateClosed` (okuma düşerse
--      TÜM üretici siparişlerinde baskı başlat/bitir/QC kapanır).
-- Ret kapısı SATIRA bakar, bu çağrılar TABLONUN VARLIĞINA: "hiç kullanılmadı, o hâlde
-- düşürmek güvenli" denen durum tam da canlıyı düşüren durumdur. Yordam:
--   (1) app + worker imajlarını 0064 ÖNCESİ commit'e geri al,
--   (2) /api/health ve ödenmiş bir siparişin kickoff'u doğrulanır,
--   (3) ancak ondan sonra bu dosya çalıştırılır. Ayrıntı: scripts/db/README.md.
--
-- OPERATÖR NOTU — ret kapsamı bilerek geniştir: `print_catalog_changes` bir DENETİM
-- tablosudur, tek bir admin katalog düzenlemesi bu script'i kalıcı olarak reddettirir.
-- Script denetim kaydını kendiliğinden SİLMEZ. Geri alma yine de isteniyorsa kaydı
-- dışa aktarıp (ör. `\copy print_catalog_changes TO '...'`) bilerek temizlemek gerekir:
--   DELETE FROM print_catalog_changes;   -- yalnız denetim geçmişi; tohum etkilenmez
-- ardından bu dosya yeniden çalıştırılır. Teklif/ödeme satırları için böyle bir
-- kestirme YOKTUR: onlar müşteri verisidir, 0064 canlı veriyle geri alınamaz.
DO $$
DECLARE
  table_name text;
  used boolean;
BEGIN
  SET LOCAL lock_timeout = '5s';
  -- Önce SAHİP OLUNAN her tabloyu kilitle: boşluk kontrolü ile DROP arasına
  -- hiçbir yazıcı giremesin. Kısmen uygulanmış şemada eksik tablo sorun değil.
  FOREACH table_name IN ARRAY ARRAY['quote_admin_actions', 'quote_messages', 'quote_checkouts', 'quote_parts', 'quotes',
    'print_catalog_changes', 'quote_pricing_settings', 'print_addons', 'print_finishes', 'print_materials', 'print_technologies'] LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', table_name);
    END IF;
  END LOOP;
  -- Teklif/ödeme satırları müşteri verisidir; katalog denetim satırı ise
  -- adminin kataloğu değiştirdiğini gösterir (tohum dışı operatör verisi).
  FOREACH table_name IN ARRAY ARRAY['quotes', 'quote_checkouts', 'quote_parts', 'quote_messages', 'quote_admin_actions', 'print_catalog_changes'] LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I)', table_name) INTO used;
      IF used THEN
        RAISE EXCEPTION '0064 rollback refused: % contains quote or catalog history', table_name;
      END IF;
    END IF;
  END LOOP;
  DROP TABLE IF EXISTS public.quote_admin_actions;
  DROP TABLE IF EXISTS public.quote_messages;
  DROP TABLE IF EXISTS public.quote_checkouts;
  DROP TABLE IF EXISTS public.quote_parts;
  DROP TABLE IF EXISTS public.quotes;
  DROP TABLE IF EXISTS public.print_catalog_changes;
  DROP TABLE IF EXISTS public.quote_pricing_settings;
  DROP TABLE IF EXISTS public.print_addons;
  DROP TABLE IF EXISTS public.print_finishes;
  DROP TABLE IF EXISTS public.print_materials;
  DROP TABLE IF EXISTS public.print_technologies;
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1789657000000;
  END IF;
END $$;
