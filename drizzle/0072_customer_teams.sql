-- Takım çalışma alanı: kurumsal müşterinin teklifi birden çok kişiye açılır.
--
-- Dört tablo (`customer_teams`, `customer_team_members`,
-- `customer_team_invites`, `customer_team_actions`) ve `quotes`a bir nullable
-- kolon (`team_id`). Hiçbir satır YAZMAZ, var olan hiçbir kolonu DEĞİŞTİRMEZ,
-- hiçbir veriyi silmez; tohum taşımaz. Geri alma: 0072_customer_teams.down.sql
-- (psql ile elle uygulanır).
--
-- ─── BU MIGRATION HİÇBİR DAVRANIŞI DEĞİŞTİRMEZ ─────────────────────────────
--
-- `quote_teams_enabled` KAPALI doğar ve bu sevkiyatta `quotes.team_id`yi OKUYAN
-- tek satır yoktur. Kolon ve tablolar ilk okumadan (T-2) ÖNCE iner, çünkü
-- erişim matrisine dal eklemek ile şema değiştirmek aynı sevkiyatta olursa
-- geri dönüş iki ayrı işi birden geri almak zorunda kalır.
--
-- ─── SAHİBİN KARARI 6.5: BİR KULLANICI EN FAZLA BİR TAKIMDA ────────────────
--
-- `customer_team_members_user_uq` UNIQUE `(user_id)`. Kod tarafındaki "tek
-- takım" varsayımı bir yorum değil bir KISIT: çok takımlı üyelik ve takım
-- seçici bu indeks dururken yazılamaz.
--
-- `customer_team_members_one_owner_idx` UNIQUE `(team_id) WHERE role = 'owner'`
-- ikinci kısıttır: eşzamanlı iki "sahipliği devret" çağrısından yalnız biri
-- yazabilir. Kısmi tekil indeks deseni `user_addresses_one_default_idx` ile
-- aynıdır.
--
-- `customer_team_invites_live_uq` UNIQUE `(team_id, email) WHERE accepted_at IS
-- NULL AND revoked_at IS NULL`: aynı adrese iki CANLI davet olmaz, ikinci davet
-- bir "yenile" işlemidir. İptal yenilemeyi SERBEST BIRAKIR. Bu indeksin
-- atlatılmaması e-postanın TEK yerde normalize edilmesine bağlı
-- (`normalizeTeamEmail` · src/lib/config/quote-team.ts).
--
-- ─── `quotes_team_requires_user_chk` — EN ÖNEMLİ KISIT ─────────────────────
--
-- `team_id IS NULL OR user_id IS NOT NULL`: ANONİM TEKLİF ASLA TAKIM TEKLİFİ
-- OLAMAZ. T-2'nin erişim matrisine ekleyeceği takım dalının mevcut anonim-çerez
-- dalıyla ÇAKIŞAMAYACAĞININ dayanağı budur — takım teklifinde `user_id` daima
-- doludur, yani anonim dalın ilk koşulu (`user_id IS NULL`) hiç tutmaz. Çerez
-- kimliğine takım bağlamak, tarayıcıyı paylaşan iki kişiye takım açmak olurdu.
-- Bu yüzden kısıt bir yorum değil, veritabanı kuralıdır.
--
-- ─── `orders` VE `order_drafts`a HİÇBİR KOLON EKLENMEZ ─────────────────────
--
-- Takımın siparişi görmesi `quotes.team_id` + `quotes.order_id` üzerinden
-- TÜRETİLİR; ikinci bir kolon aynı gerçeğin ikinci kopyası olurdu.
--
-- ─── NEDEN pg enum DEĞİL ───────────────────────────────────────────────────
--
-- `role`, `invoice_type` ve `action` `text` + adlandırılmış CHECK (ev kuralı,
-- gerekçesi `src/lib/db/schema.ts`in "Anlık teklif motoru" blok başlığında):
-- bir CHECK'i düşürüp yeniden kurmak GERİ ALINABİLİR, `ALTER TYPE ... ADD
-- VALUE` olmazdı. Listeler `src/lib/config/quote-team.ts`teki `TEAM_ROLES`,
-- `TEAM_INVITE_ROLES` ve `TEAM_ACTIONS`tan türer (`schema.ts` · `quoteInList`);
-- ikisi ayrışırsa uygulama katalog dışı bir değer yazmaya kalkar, veritabanı
-- 23514 ile reddeder ve müşteri boş gövdeli bir 500 görür. Eşitlik bu yüzden
-- `scripts/test-quote-team-migration-db.ts` tarafından kaynak üzerinden de
-- sınanır.
--
-- `customer_team_invites.role` listesinde `'owner'` YOKTUR: sahiplik bir
-- davetin kabulüyle doğmaz, tek yolu devirdir.
--
-- ─── IDEMPOTENT ────────────────────────────────────────────────────────────
--
-- `IF NOT EXISTS` ve `DO $$ … conname` kalıbı: yarı kalmış bir turdan sonra
-- yeniden koşabilir (drizzle-kit `ADD CONSTRAINT`i `IF NOT EXISTS` ile
-- üretmez; 0064, 0071 ve 0073'te de elle düzeltilmiş).
-- `public.` ÖNEKİ ZORUNLU: round-trip testi şemayı tek kullanımlık bir isim
-- alanına taşımak için `public.` → `"<ns>".` yerine koyma yapıyor; önek
-- yazılmazsa test izolasyonu çöker ve test QA'nın gerçek şemasına yazar.
SET lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."customer_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"invoice_type" text DEFAULT 'individual' NOT NULL,
	"company_name" text,
	"tax_id" text,
	"tax_id_type" text,
	"tax_office" text,
	"billing_address" jsonb,
	"shipping_address" jsonb,
	"member_can_checkout" boolean DEFAULT false NOT NULL,
	"kvkk_notice_version" text NOT NULL,
	"kvkk_consent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_teams_invoice_type_chk" CHECK ("customer_teams"."invoice_type" IN ('individual', 'corporate')),
	CONSTRAINT "customer_teams_tax_id_type_chk" CHECK ("customer_teams"."tax_id_type" IS NULL OR "customer_teams"."tax_id_type" IN ('vkn', 'tckn'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."customer_team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"invited_by_user_id" uuid,
	"kvkk_acknowledged_at" timestamp with time zone,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_team_members_role_chk" CHECK ("customer_team_members"."role" IN ('owner', 'admin', 'member', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."customer_team_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by_user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_team_invites_role_chk" CHECK ("customer_team_invites"."role" IN ('admin', 'member', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."customer_team_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"target_user_id" uuid,
	"target_quote_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_team_actions_action_chk" CHECK ("customer_team_actions"."action" IN ('team_created', 'team_renamed', 'billing_updated', 'shipping_updated', 'invite_sent', 'invite_revoked', 'invite_accepted', 'role_changed', 'member_removed', 'member_left', 'ownership_transferred', 'quote_attached', 'quote_detached', 'checkout_cancelled'))
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.customer_teams'::regclass AND conname = 'customer_teams_owner_user_id_users_id_fk') THEN
    ALTER TABLE "public"."customer_teams" ADD CONSTRAINT "customer_teams_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.customer_team_members'::regclass AND conname = 'customer_team_members_team_id_customer_teams_id_fk') THEN
    ALTER TABLE "public"."customer_team_members" ADD CONSTRAINT "customer_team_members_team_id_customer_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."customer_teams"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.customer_team_members'::regclass AND conname = 'customer_team_members_user_id_users_id_fk') THEN
    ALTER TABLE "public"."customer_team_members" ADD CONSTRAINT "customer_team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.customer_team_members'::regclass AND conname = 'customer_team_members_invited_by_user_id_users_id_fk') THEN
    ALTER TABLE "public"."customer_team_members" ADD CONSTRAINT "customer_team_members_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.customer_team_invites'::regclass AND conname = 'customer_team_invites_team_id_customer_teams_id_fk') THEN
    ALTER TABLE "public"."customer_team_invites" ADD CONSTRAINT "customer_team_invites_team_id_customer_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."customer_teams"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.customer_team_invites'::regclass AND conname = 'customer_team_invites_invited_by_user_id_users_id_fk') THEN
    ALTER TABLE "public"."customer_team_invites" ADD CONSTRAINT "customer_team_invites_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.customer_team_invites'::regclass AND conname = 'customer_team_invites_accepted_user_id_users_id_fk') THEN
    ALTER TABLE "public"."customer_team_invites" ADD CONSTRAINT "customer_team_invites_accepted_user_id_users_id_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.customer_team_invites'::regclass AND conname = 'customer_team_invites_revoked_by_user_id_users_id_fk') THEN
    ALTER TABLE "public"."customer_team_invites" ADD CONSTRAINT "customer_team_invites_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.customer_team_actions'::regclass AND conname = 'customer_team_actions_team_id_customer_teams_id_fk') THEN
    ALTER TABLE "public"."customer_team_actions" ADD CONSTRAINT "customer_team_actions_team_id_customer_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."customer_teams"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.customer_team_actions'::regclass AND conname = 'customer_team_actions_actor_user_id_users_id_fk') THEN
    ALTER TABLE "public"."customer_team_actions" ADD CONSTRAINT "customer_team_actions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.customer_team_actions'::regclass AND conname = 'customer_team_actions_target_user_id_users_id_fk') THEN
    ALTER TABLE "public"."customer_team_actions" ADD CONSTRAINT "customer_team_actions_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.customer_team_actions'::regclass AND conname = 'customer_team_actions_target_quote_id_quotes_id_fk') THEN
    ALTER TABLE "public"."customer_team_actions" ADD CONSTRAINT "customer_team_actions_target_quote_id_quotes_id_fk" FOREIGN KEY ("target_quote_id") REFERENCES "public"."quotes"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "customer_team_members_team_user_uq" ON "public"."customer_team_members" USING btree ("team_id","user_id");
--> statement-breakpoint
-- SAHİBİN KARARI 6.5: bir kullanıcı EN FAZLA BİR takımda.
CREATE UNIQUE INDEX IF NOT EXISTS "customer_team_members_user_uq" ON "public"."customer_team_members" USING btree ("user_id");
--> statement-breakpoint
-- Takım başına TEK sahip: iki eşzamanlı devir çağrısından biri 23505 alır.
CREATE UNIQUE INDEX IF NOT EXISTS "customer_team_members_one_owner_idx" ON "public"."customer_team_members" USING btree ("team_id") WHERE "customer_team_members"."role" = 'owner';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_team_members_team_idx" ON "public"."customer_team_members" USING btree ("team_id","role");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "customer_team_invites_token_uq" ON "public"."customer_team_invites" USING btree ("token_hash");
--> statement-breakpoint
-- Aynı adrese iki CANLI davet olmaz; iptal yenilemeyi serbest bırakır.
CREATE UNIQUE INDEX IF NOT EXISTS "customer_team_invites_live_uq" ON "public"."customer_team_invites" USING btree ("team_id","email") WHERE "customer_team_invites"."accepted_at" IS NULL AND "customer_team_invites"."revoked_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_team_invites_team_idx" ON "public"."customer_team_invites" USING btree ("team_id","created_at" DESC NULLS LAST);
--> statement-breakpoint
-- Nullable: bugünkü her teklif NULL ile yaşar (bayrak kapalı → takım yok).
ALTER TABLE "public"."quotes" ADD COLUMN IF NOT EXISTS "team_id" uuid;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.quotes'::regclass AND conname = 'quotes_team_id_customer_teams_id_fk') THEN
    ALTER TABLE "public"."quotes" ADD CONSTRAINT "quotes_team_id_customer_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."customer_teams"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
-- Takım listesinin TEK sorgusu.
CREATE INDEX IF NOT EXISTS "quotes_team_idx" ON "public"."quotes" USING btree ("team_id","created_at" DESC NULLS LAST);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.quotes'::regclass AND conname = 'quotes_team_requires_user_chk') THEN
    ALTER TABLE "public"."quotes" ADD CONSTRAINT "quotes_team_requires_user_chk" CHECK ("quotes"."team_id" IS NULL OR "quotes"."user_id" IS NOT NULL);
  END IF;
END $$;
