-- 0072 geri alma: dört takım tablosu ve `quotes.team_id` kolonu düşer.
-- Elle uygulanır (psql); journal'da yer almaz.
--
-- ─── SIRA ZORUNLU — ÖNCE UYGULAMA, SONRA BU DOSYA ──────────────────────────
--
-- (1) app + worker imajları 0072 ÖNCESİ commit'e geri alınır ve doğrulanır,
-- (2) ancak ondan SONRA bu dosya çalıştırılır.
--
-- Gerekçe SOMUT ve ÖLÇÜLMÜŞ, "ihtimal" değil: `resolveQuoteAccess`
-- (src/lib/services/quote-access.ts:376) teklifi `db.select()` ile TÜM
-- kolonlarıyla çekiyor. `team_id` kod hâlâ onu seçerken düşerse HER TEKLİF
-- AÇILIŞI 42703 ile boş gövdeli bir 500 döner — müşteri yüzeyinin tamamı
-- (teklif sayfası, ödeme, sohbet, belge) kapanır. "Özellik hiç kullanılmadı,
-- kolonu düşürmek güvenli" denen durum tam da canlıyı düşüren durumdur.
--
-- `quote_teams_enabled` bayrağını kapatmak bu dosyanın YERİNE GEÇMEZ: bayrak
-- rol OKUMASINI kapatır, `select()`in kolon listesini değiştirmez.
-- Ayrıntı: scripts/db/README.md.
--
-- ─── REDDEDER: TEK BİR TAKIM SATIRI VARSA DURUR ────────────────────────────
--
-- Dört tablodan herhangi birinde satır varsa VEYA takıma bağlı bir teklif
-- varsa (`quotes.team_id IS NOT NULL`) geri alma hiçbir şeye dokunmadan DURUR.
-- Bunlar MÜŞTERİ VERİSİDİR ve `CASCADE` ile silmek bir müşteri kaydını
-- silmektir:
--
--   * üyeli bir takım bir PAYLAŞIM İLİŞKİSİNİN kaydıdır — kimin kimin
--     teklifini görmeye hakkı olduğunun tek yazılı hâli,
--   * `customer_team_invites` bir adrese davet GÖNDERİLDİĞİNİN (KVKK
--     açısından: kişisel veriyi kimin paylaştığının) kaydıdır,
--   * `customer_team_actions` denetim izidir: "rolümü kim düşürdü",
--     "ödememi kim iptal etti" sorularının tek cevabı,
--   * `quotes.team_id` dolu bir teklif bir ŞİRKETİN işidir; kolonu düşürmek o
--     teklifin kime ait olduğunu geri getirilemez biçimde siler.
--
-- Ret bir `RAISE EXCEPTION`dır: blok atomik olarak geri sarılır, tablolar,
-- kolon ve kayıt satırı YERİNDE kalır. Gerçekten geri alınmak isteniyorsa
-- operatör ÖNCE veriyi dışa aktarır ve takımları BİLEREK kapatır:
--   \copy (SELECT * FROM customer_teams) TO 'customer_teams.csv' CSV HEADER
--   \copy (SELECT * FROM customer_team_members) TO 'customer_team_members.csv' CSV HEADER
--   \copy (SELECT * FROM customer_team_invites) TO 'customer_team_invites.csv' CSV HEADER
--   \copy (SELECT * FROM customer_team_actions) TO 'customer_team_actions.csv' CSV HEADER
--   \copy (SELECT id, number, team_id FROM quotes WHERE team_id IS NOT NULL) TO 'quotes_team_id.csv' CSV HEADER
-- Sonra teklifleri takımdan ayırır (`UPDATE quotes SET team_id = NULL WHERE
-- team_id IS NOT NULL`), denetim/davet/üyelik satırlarını siler ve bu dosyayı
-- yeniden çalıştırır. Kolon geri geldiğinde (up yeniden uygulandığında) bağ
-- YENİDEN TÜRETİLMEZ: up hiçbir satır yazmaz, o yüzden yedek şarttır.
--
-- Yalnız up'ın EKLEDİĞİ tablolara ve kolona dokunur; `quotes`un öteki
-- kolonları, teklif satırları, `users` ve operatör verisi YERİNDE KALIR.
-- `IF EXISTS` sayesinde tekrar çalıştırılabilir; kilit, ret kontrolü, DDL ve
-- journal satırının silinmesi tek işlemde atomiktir.
--
-- ─── DRIZZLE KAYIT SATIRI: KENDİ SATIRINI SİLER ─────────────────────────────
--
-- Silinen satır 0072'nin KENDİ etiketidir: `created_at`, journal'daki `when`
-- değeridir (drizzle/meta/_journal.json · idx 72 · tag 0072_customer_teams ·
-- when 1790794400000). "En son eklenen satırı sil" (ORDER BY created_at DESC
-- LIMIT 1) tarifi YASAKTIR: 0072 en yeni değildir (üstünde 0073 var) ve o tarif
-- BAŞKA bir migration'ın kaydını silerdi. `hash` ile silmek de yasaktır — hash
-- dosya İÇERİĞİNİN sha256'sıdır, dosya her düzeltildiğinde değişir ve silme
-- sessizce hiçbir satıra dokunmaz.
--
-- Altındaki bir migration da geri alınacaksa SIRA EN YENİDEN ESKİYE doğrudur:
-- ilk 0073, sonra bu dosya, sonra 0071, 0070, 0067, 0066, 0065, 0064 … (tam
-- tarif: drizzle/0055_qc_photo_model_revision.down.sql).
DO $$
DECLARE
  owned text;
  rowcount bigint;
  used boolean;
BEGIN
  SET LOCAL lock_timeout = '5s';
  -- BOŞLUK KONTROLÜ İLE DROP ARASINA YAZICI GİRMESİN: kilitler önce alınır,
  -- yoksa kontrolden sonra açılan bir takım sessizce silinirdi.
  FOREACH owned IN ARRAY ARRAY[
    'customer_team_actions', 'customer_team_invites', 'customer_team_members', 'customer_teams'
  ] LOOP
    IF to_regclass('public.' || owned) IS NOT NULL THEN
      EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', owned);
    END IF;
  END LOOP;
  IF to_regclass('public.quotes') IS NOT NULL THEN
    LOCK TABLE public.quotes IN ACCESS EXCLUSIVE MODE;
  END IF;

  -- RET 1: sahip olunan dört tablodan herhangi birinde satır var mı.
  FOREACH owned IN ARRAY ARRAY[
    'customer_team_actions', 'customer_team_invites', 'customer_team_members', 'customer_teams'
  ] LOOP
    IF to_regclass('public.' || owned) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', owned) INTO rowcount;
      IF rowcount > 0 THEN
        RAISE EXCEPTION '0072 rollback refused: % tablosunda % satır var ve bu müşteri verisidir (takım, üyelik, davet, denetim izi). Yapılacak: satırları dışa aktarın (\copy tarifi bu dosyanın başında), takımları müşteriyle BİLEREK kapatın ve satırları silin, sonra bu dosyayı yeniden çalıştırın. Bulmak için: SELECT * FROM %I;', owned, rowcount, owned;
      END IF;
    END IF;
  END LOOP;

  -- RET 2 (AYRI BİR KAPI): tablolar boş olsa bile takıma bağlı bir teklif
  -- durabilir — tetikleyicileri kapatılmış bir geri yükleme (`pg_restore
  -- --disable-triggers`) tam bu hâli kurar ve o teklifin kime ait olduğu
  -- yalnız bu kolonda yazılıdır.
  IF to_regclass('public.quotes') IS NOT NULL
    AND EXISTS (SELECT 1 FROM pg_attribute
      WHERE attrelid = to_regclass('public.quotes')
        AND attname = 'team_id' AND attnum > 0 AND NOT attisdropped) THEN
    SELECT EXISTS (SELECT 1 FROM public.quotes WHERE team_id IS NOT NULL) INTO used;
    IF used THEN
      RAISE EXCEPTION '0072 rollback refused: takıma bağlı teklif var (quotes.team_id). Yapılacak: bağları dışa aktarın (\copy tarifi bu dosyanın başında) ve o teklifleri takımdan ayırın (UPDATE quotes SET team_id = NULL WHERE team_id IS NOT NULL), sonra bu dosyayı yeniden çalıştırın. Bulmak için: SELECT id, number, team_id FROM quotes WHERE team_id IS NOT NULL;';
    END IF;
    DROP INDEX IF EXISTS public.quotes_team_idx;
    ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_team_requires_user_chk;
    -- FK (`quotes_team_id_customer_teams_id_fk`) kolonla birlikte düşer.
    ALTER TABLE public.quotes DROP COLUMN IF EXISTS team_id;
  END IF;

  -- Çocuktan ebeveyne: `restrict` FK'ler ters sırada DROP'u reddederdi.
  DROP TABLE IF EXISTS public.customer_team_actions;
  DROP TABLE IF EXISTS public.customer_team_invites;
  DROP TABLE IF EXISTS public.customer_team_members;
  DROP TABLE IF EXISTS public.customer_teams;

  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1790794400000;
  END IF;
END $$;
