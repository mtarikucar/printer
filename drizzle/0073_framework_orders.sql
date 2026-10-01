-- Çerçeve siparişler: anlaşma + parti + parti satırı tabloları ve denetim
-- listesinin sekiz yeni değeri.
--
-- Üç YENİ tablo kurar, `quote_admin_actions_action_chk` kısıdını yeniden kurar.
-- Hiçbir satır YAZMAZ, var olan hiçbir kolonu değiştirmez, hiçbir veriyi
-- silmez; tohum taşımaz. Geri alma: 0073_framework_orders.down.sql (psql ile
-- elle uygulanır — ama SIRA vardır, o dosyanın başlığını okumadan
-- çalıştırmayın).
--
-- ─── ÖDEME PARTİ BAŞINADIR — bu migration'ın birinci kuralı ────────────────
--
-- Anlaşma FİYATI ve TAAHHÜDÜ bağlar, PARAYI bağlamaz: tahsilat yok, teslim
-- taahhüdü parti serbest bırakılınca doğar. Serbest bırakılan parti KENDİ
-- `quotes` klonunu alır ve bugünkü ödeme yolundan geçer. Bu yüzden `orders`,
-- `order_drafts` ve `quotes` tablolarına TEK KOLON EKLENMEZ: köprü
-- `quote_framework_batches.quote_id/draft_id/order_id`dir ve `quotes_order_id_uq`
-- (bir teklif = bir sipariş) korunur, çünkü her parti KENDİ teklifini alır.
--
-- ─── PARA DEĞİŞMEZİ SQL DÜZEYİNDE ─────────────────────────────────────────
--
-- `quote_framework_batch_lines_line_chk`: `line_kurus = unit_kurus * quantity`.
-- Aynı kural saf çekirdekte (`frameworkLineKurus`) ve teklif motorunun manuel
-- dalında (`quote-compute.ts`) duruyor — ÜÇ YER, TEK aritmetik. Kısıt
-- savunma DERİNLİĞİdir: ikinci bir yazan (bakım betiği, elle bir UPDATE,
-- ileride yeni bir uç) ekranı atlasa bile satır tutarı fiyatı yalanlayamaz.
--
-- `quote_framework_batches_amount_chk`: parti tutarı TEK ÖDEMEdir, yani
-- `MAX_AMOUNT_KURUS` (₺2.000.000 = 200000000 kuruş, src/lib/config/prices.ts)
-- tavanı aynen geçerli. Çerçeve TOPLAMI onu aşabilir; bu yüzden
-- `quote_frameworks.committed_total_kurus` `bigint`tir (`integer` tavanı ₺21.4M).
--
-- `quote_framework_batches_released_chk`: "serbest bırakıldı ama klonu yok"
-- hâli DB'de DOĞMAZ (`status <> 'released'` ya da klon + damga).
--
-- ─── TÜM FK'LER `on delete restrict` ──────────────────────────────────────
--
-- Kaynak teklif, kullanıcı, tercih edilen üretici, klon teklif, taslak ve
-- sipariş — hiçbiri cascade DEĞİL. Anlaşma bir SÖZLEŞMEDİR; öksüz kalması
-- detay sayfasında 500 demektir.
--
-- ─── PARTİ SATIRININ ÇERÇEVESİ, PARTİSİNİN ÇERÇEVESİDİR ───────────────────
--
-- `quote_framework_batch_lines.framework_id` `quote_frameworks`a BAĞIMSIZ bir
-- FK ile BAĞLANMAZ. Böyle bir FK yalnız "var olan BİR çerçeve" derdi ve hiçbir
-- kısıt "bu satırın çerçevesi, satırın PARTİSİNİN çerçevesiyle aynı olmalı"
-- demezdi: bir satır, partisinin ait OLMADIĞI bir çerçeveyi iddia edebilir ve
-- parça başına döküm (`quote_framework_batch_lines_fw_part_idx` üzerinden
-- `(framework_id, part_id)` ile okunan) sessizce kayardı. O döküm taahhüdün ne
-- kadarının TÜKETİLDİĞİNİ söyleyen PARA okumasıdır.
--
-- Bu yüzden bağ BİLEŞİKtir: `(batch_id, framework_id)` →
-- `quote_framework_batches(id, framework_id)`, hedefi
-- `quote_framework_batches_id_framework_id_unique` tekil kısıdı (yukarıdaki
-- CREATE TABLE'da; `id` birincil anahtar olduğu için mantıksal olarak bedava
-- ama bileşik FK'nin kurulabilmesi için YAZILMASI ZORUNLU). `quote_frameworks`a
-- bütünlük transitif olarak durur: parti satırın çerçevesini, parti de
-- çerçeveyi `restrict` ile tutar. Yan fayda: satırı olan bir parti BAŞKA bir
-- çerçeveye taşınamaz (`ON UPDATE no action`).
--
-- ─── FK ADLARI 63 KARAKTERİ AŞMAZ ─────────────────────────────────────────
--
-- `quote_framework_batch_lines_batch_id_fk` (39 bayt) ve
-- `quote_framework_batch_lines_batch_framework_fk` (46 bayt) bilerek KISA
-- yazıldı. Drizzle'ın türeteceği adlar 66 ve 91 karakter olurdu; Postgres
-- kimlikleri 63 bayta SESSİZCE kırpar ve kırpılmış ad aşağıdaki
-- `conname = '<tam ad>'` kontrolüyle hiç eşleşmezdi — up ikinci koşuda kısıdı
-- yeniden eklemeye kalkar ve "already exists" ile düşerdi (0061'de duran latent
-- hata tam budur: `gift_credit_returns_refund_allocation_id_order_refund_allocations_id_fk`,
-- 71 karakter). `schema.ts` aynı adları `foreignKey({ name: ... })` ile yazıyor
-- ve `scripts/test-framework-migration-db.ts` bu dosyadaki her kısıt/indeks
-- adının baytını SAYIYOR.
--
-- ─── NEDEN pg enum DEĞİL ──────────────────────────────────────────────────
--
-- `status` kolonları `text` + adlandırılmış CHECK (ev kuralı, gerekçesi
-- `src/lib/db/schema.ts`in "Anlık teklif motoru" blok başlığında): bir CHECK'i
-- düşürüp yeniden kurmak GERİ ALINABİLİR, `ALTER TYPE ... ADD VALUE` olmazdı.
-- Listeler tip sözleşmesinden türer (`FRAMEWORK_STATUSES` / `BATCH_STATUSES`,
-- `src/lib/config/quote-framework.ts` · `schema.ts` `quoteInList`); ayrışırsa
-- uygulama katalog dışı bir durum yazmaya kalkar, veritabanı 23514 ile
-- reddeder ve müşteri boş gövdeli bir 500 görür. Eşitlik bu yüzden
-- `scripts/test-framework-migration-db.ts` tarafından kaynak üzerinden de
-- sınanır.
--
-- ─── DENETİM İZİ VAR OLAN TABLODA KALIR ───────────────────────────────────
--
-- `quote_admin_actions.quote_id` NOT NULL ve çerçevenin kaynak teklifi HER
-- ZAMAN vardır, yani iz `/admin/teklifler/[id]` detayında kendiliğinden
-- görünür. Yeni bir denetim tablosu ikinci bir okuma yüzeyi demekti. Liste
-- `QUOTE_ADMIN_ACTIONS`tan üretildiği için kısıt DROP + ADD ile yeniden
-- kurulur (0066/0070'in kısıt takası deseni) ve tekrar çalıştırılabilir.
--
-- ─── IDEMPOTENT ───────────────────────────────────────────────────────────
--
-- `IF NOT EXISTS` / `DROP … IF EXISTS` her yerde: yarı kalmış bir turdan sonra
-- yeniden koşabilir. `public.` ÖNEKİ ZORUNLU: round-trip testi şemayı tek
-- kullanımlık bir isim alanına taşımak için `"public".` ve `public.`ı yer
-- değiştiriyor; önek yazılmazsa test izolasyonu çöker ve test QA'nın GERÇEK
-- şemasına yazar.
SET lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."quote_frameworks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "quote_frameworks_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"number" text GENERATED ALWAYS AS ('C-' || lpad(seq::text, greatest(6, length(seq::text)), '0')) STORED NOT NULL,
	"quote_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"title" text,
	"lead_tier" text NOT NULL,
	"addon_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"parts_snapshot" jsonb NOT NULL,
	"addons_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pricing_snapshot" jsonb NOT NULL,
	"committed_units" integer NOT NULL,
	"committed_total_kurus" bigint NOT NULL,
	"price_locked_until" timestamp with time zone NOT NULL,
	"preferred_manufacturer_id" uuid,
	"shipping_address" jsonb NOT NULL,
	"terms_accepted_at" timestamp with time zone,
	"terms_version" text,
	"customer_note" text,
	"admin_note" text,
	"activated_at" timestamp with time zone,
	"activated_by_email" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"release_reminder_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_frameworks_seq_unique" UNIQUE("seq"),
	CONSTRAINT "quote_frameworks_number_unique" UNIQUE("number"),
	CONSTRAINT "quote_frameworks_status_chk" CHECK ("quote_frameworks"."status" IN ('draft', 'active', 'completed', 'expired', 'cancelled')),
	CONSTRAINT "quote_frameworks_lead_tier_chk" CHECK ("quote_frameworks"."lead_tier" IN ('economy', 'standard', 'express')),
	CONSTRAINT "quote_frameworks_units_chk" CHECK ("quote_frameworks"."committed_units" > 0),
	CONSTRAINT "quote_frameworks_total_chk" CHECK ("quote_frameworks"."committed_total_kurus" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."quote_framework_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"framework_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"planned_ship_date" date NOT NULL,
	"units" integer NOT NULL,
	"amount_kurus" integer NOT NULL,
	"quote_id" uuid,
	"draft_id" uuid,
	"order_id" uuid,
	"released_at" timestamp with time zone,
	"released_by_email" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_framework_batches_id_framework_id_unique" UNIQUE("id","framework_id"),
	CONSTRAINT "quote_framework_batches_status_chk" CHECK ("quote_framework_batches"."status" IN ('planned', 'released', 'cancelled')),
	CONSTRAINT "quote_framework_batches_position_chk" CHECK ("quote_framework_batches"."position" >= 1),
	CONSTRAINT "quote_framework_batches_units_chk" CHECK ("quote_framework_batches"."units" > 0),
	CONSTRAINT "quote_framework_batches_amount_chk" CHECK ("quote_framework_batches"."amount_kurus" > 0 AND "quote_framework_batches"."amount_kurus" <= 200000000),
	CONSTRAINT "quote_framework_batches_released_chk" CHECK (("quote_framework_batches"."status" <> 'released') OR ("quote_framework_batches"."quote_id" IS NOT NULL AND "quote_framework_batches"."released_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."quote_framework_batch_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"framework_id" uuid NOT NULL,
	"part_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"quantity" integer NOT NULL,
	"unit_kurus" integer NOT NULL,
	"line_kurus" integer NOT NULL,
	CONSTRAINT "quote_framework_batch_lines_qty_chk" CHECK ("quote_framework_batch_lines"."quantity" BETWEEN 1 AND 100000),
	CONSTRAINT "quote_framework_batch_lines_unit_chk" CHECK ("quote_framework_batch_lines"."unit_kurus" > 0),
	CONSTRAINT "quote_framework_batch_lines_line_chk" CHECK ("quote_framework_batch_lines"."line_kurus" = "quote_framework_batch_lines"."unit_kurus" * "quote_framework_batch_lines"."quantity")
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.quote_frameworks'::regclass AND conname = 'quote_frameworks_quote_id_quotes_id_fk') THEN
    ALTER TABLE "public"."quote_frameworks" ADD CONSTRAINT "quote_frameworks_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.quote_frameworks'::regclass AND conname = 'quote_frameworks_user_id_users_id_fk') THEN
    ALTER TABLE "public"."quote_frameworks" ADD CONSTRAINT "quote_frameworks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.quote_frameworks'::regclass AND conname = 'quote_frameworks_preferred_manufacturer_id_manufacturers_id_fk') THEN
    ALTER TABLE "public"."quote_frameworks" ADD CONSTRAINT "quote_frameworks_preferred_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("preferred_manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.quote_framework_batches'::regclass AND conname = 'quote_framework_batches_framework_id_quote_frameworks_id_fk') THEN
    ALTER TABLE "public"."quote_framework_batches" ADD CONSTRAINT "quote_framework_batches_framework_id_quote_frameworks_id_fk" FOREIGN KEY ("framework_id") REFERENCES "public"."quote_frameworks"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.quote_framework_batches'::regclass AND conname = 'quote_framework_batches_quote_id_quotes_id_fk') THEN
    ALTER TABLE "public"."quote_framework_batches" ADD CONSTRAINT "quote_framework_batches_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.quote_framework_batches'::regclass AND conname = 'quote_framework_batches_draft_id_order_drafts_id_fk') THEN
    ALTER TABLE "public"."quote_framework_batches" ADD CONSTRAINT "quote_framework_batches_draft_id_order_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."order_drafts"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.quote_framework_batches'::regclass AND conname = 'quote_framework_batches_order_id_orders_id_fk') THEN
    ALTER TABLE "public"."quote_framework_batches" ADD CONSTRAINT "quote_framework_batches_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.quote_framework_batch_lines'::regclass AND conname = 'quote_framework_batch_lines_batch_id_fk') THEN
    ALTER TABLE "public"."quote_framework_batch_lines" ADD CONSTRAINT "quote_framework_batch_lines_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."quote_framework_batches"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.quote_framework_batch_lines'::regclass AND conname = 'quote_framework_batch_lines_batch_framework_fk') THEN
    ALTER TABLE "public"."quote_framework_batch_lines" ADD CONSTRAINT "quote_framework_batch_lines_batch_framework_fk" FOREIGN KEY ("batch_id","framework_id") REFERENCES "public"."quote_framework_batches"("id","framework_id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
-- Bir teklif EN FAZLA bir çerçeveye dönüşür.
CREATE UNIQUE INDEX IF NOT EXISTS "quote_frameworks_quote_id_uq" ON "public"."quote_frameworks" USING btree ("quote_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_frameworks_user_idx" ON "public"."quote_frameworks" USING btree ("user_id","created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_frameworks_status_idx" ON "public"."quote_frameworks" USING btree ("status","price_locked_until");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_frameworks_mfg_idx" ON "public"."quote_frameworks" USING btree ("preferred_manufacturer_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quote_framework_batches_fw_pos_uq" ON "public"."quote_framework_batches" USING btree ("framework_id","position");
--> statement-breakpoint
-- YARIŞ KAPISI: iki admin aynı partiyi serbest bırakırsa İKİNCİ klon burada
-- reddedilir (bir klon teklif = bir parti). Atlanamaz.
CREATE UNIQUE INDEX IF NOT EXISTS "quote_framework_batches_quote_id_uq" ON "public"."quote_framework_batches" USING btree ("quote_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quote_framework_batches_draft_id_uq" ON "public"."quote_framework_batches" USING btree ("draft_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quote_framework_batches_order_id_uq" ON "public"."quote_framework_batches" USING btree ("order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_framework_batches_plan_idx" ON "public"."quote_framework_batches" USING btree ("planned_ship_date","status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quote_framework_batch_lines_batch_part_uq" ON "public"."quote_framework_batch_lines" USING btree ("batch_id","part_id");
--> statement-breakpoint
-- Kırılım sorgusunun tek GROUP BY'ı.
CREATE INDEX IF NOT EXISTS "quote_framework_batch_lines_fw_part_idx" ON "public"."quote_framework_batch_lines" USING btree ("framework_id","part_id");
--> statement-breakpoint
DO $$
BEGIN
  SET LOCAL lock_timeout = '5s';
  IF to_regclass('public.quote_admin_actions') IS NULL THEN
    RAISE EXCEPTION '0073: public.quote_admin_actions yok — önce 0064_instant_quotes uygulanmalı.';
  END IF;
  -- Kısıt takası ile yazıcılar arasına kimse girmesin. `ALTER TABLE` bu kilidi
  -- kendiliğinden alır; açıkça almak pencereyi tek bir yere toplar.
  LOCK TABLE public.quote_admin_actions IN ACCESS EXCLUSIVE MODE;
  -- Tekrar çalıştırılabilir: `IF EXISTS` ile düşür, sonra kur. Liste
  -- GENİŞLİYOR, yani bugün geçerli olan her satır yarın da geçerli — doğrulama
  -- taraması ucuz ve düşme riski yok, o yüzden kısıt DOĞRULANMIŞ eklenir.
  ALTER TABLE public.quote_admin_actions DROP CONSTRAINT IF EXISTS quote_admin_actions_action_chk;
  ALTER TABLE public.quote_admin_actions ADD CONSTRAINT quote_admin_actions_action_chk
    CHECK (action IN ('manual_price', 'target_accept', 'target_counter', 'target_reject', 'review_reject', 'extend_expiry', 'reopen', 'framework_create', 'framework_activate', 'framework_batch_plan', 'framework_batch_release', 'framework_batch_cancel', 'framework_cancel', 'framework_extend', 'framework_update'));
END $$;
