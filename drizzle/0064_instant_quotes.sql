-- Anlık teklif motoru: baskı kataloğu + teklif/parça/ödeme/sohbet tabloları ve
-- başlangıç tohumu. Yalnızca ekleme yapar; mevcut tablolara dokunmaz, veri
-- taşımaz. Geri alma: 0064_instant_quotes.down.sql (psql ile elle uygulanır).
SET lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "print_addons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_type" text NOT NULL,
	"price_kurus" integer NOT NULL,
	"lead_days_extra" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "print_addons_key_unique" UNIQUE("key"),
	CONSTRAINT "print_addons_price_type_chk" CHECK ("print_addons"."price_type" IN ('fixed', 'per_part', 'per_unit'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "print_catalog_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid,
	"action" text NOT NULL,
	"admin_email" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "print_catalog_changes_entity_chk" CHECK ("print_catalog_changes"."entity" IN ('technology', 'material', 'finish', 'addon', 'settings')),
	CONSTRAINT "print_catalog_changes_action_chk" CHECK ("print_catalog_changes"."action" IN ('create', 'update'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "print_finishes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"technology_id" uuid,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"fixed_kurus" integer DEFAULT 0 NOT NULL,
	"per_cm2_kurus" integer DEFAULT 0 NOT NULL,
	"lead_days_extra" integer DEFAULT 0 NOT NULL,
	"requires_manual" boolean DEFAULT false NOT NULL,
	"cost_line_kind" text DEFAULT 'production' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "print_finishes_key_unique" UNIQUE("key"),
	CONSTRAINT "print_finishes_cost_line_kind_chk" CHECK ("print_finishes"."cost_line_kind" IN ('production', 'painting'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "print_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"technology_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"density_g_cm3" double precision NOT NULL,
	"price_kurus_per_gram" integer NOT NULL,
	"support_factor" double precision DEFAULT 1 NOT NULL,
	"capability_tag" text,
	"colors" jsonb NOT NULL,
	"lead_days_extra" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "print_materials_support_factor_chk" CHECK ("print_materials"."support_factor" >= 1),
	CONSTRAINT "print_materials_colors_chk" CHECK (jsonb_typeof("print_materials"."colors") = 'array' AND jsonb_array_length("print_materials"."colors") >= 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "print_technologies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"order_material" text NOT NULL,
	"capability_tag" text NOT NULL,
	"build_x_mm" integer NOT NULL,
	"build_y_mm" integer NOT NULL,
	"build_z_mm" integer NOT NULL,
	"min_wall_mm" double precision NOT NULL,
	"min_feature_mm" double precision NOT NULL,
	"tolerance_text" text NOT NULL,
	"layer_options_um" jsonb NOT NULL,
	"default_layer_um" integer NOT NULL,
	"infill_options_pct" jsonb,
	"default_infill_pct" integer,
	"shell_mm" double precision DEFAULT 0 NOT NULL,
	"setup_fee_kurus" integer NOT NULL,
	"machine_rate_kurus_per_hour" integer NOT NULL,
	"throughput_cm3_per_hour" double precision NOT NULL,
	"height_hours_per_mm" double precision NOT NULL,
	"min_unit_price_kurus" integer NOT NULL,
	"base_lead_days" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "print_technologies_key_unique" UNIQUE("key"),
	CONSTRAINT "print_technologies_key_chk" CHECK ("print_technologies"."key" ~ '^[a-z0-9_]{2,32}$'),
	CONSTRAINT "print_technologies_order_material_chk" CHECK ("print_technologies"."order_material" IN ('resin', 'filament'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quote_admin_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"quote_part_id" uuid,
	"action" text NOT NULL,
	"admin_email" text NOT NULL,
	"reason" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_admin_actions_action_chk" CHECK ("quote_admin_actions"."action" IN ('manual_price', 'target_accept', 'target_counter', 'target_reject', 'review_reject', 'extend_expiry', 'reopen'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quote_checkouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"quote_version" integer NOT NULL,
	"amount_kurus" integer NOT NULL,
	"parts_snapshot" jsonb NOT NULL,
	"addons_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lead_tier" text DEFAULT 'standard' NOT NULL,
	"lead_days" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_checkouts_lead_tier_chk" CHECK ("quote_checkouts"."lead_tier" IN ('economy', 'standard', 'express'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quote_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"sender" text NOT NULL,
	"sender_user_id" uuid,
	"sender_email" text,
	"body" text NOT NULL,
	"attachment_key" text,
	"attachment_thumbnail_key" text,
	"read_by_admin_at" timestamp with time zone,
	"read_by_customer_at" timestamp with time zone,
	"flagged" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_messages_sender_chk" CHECK ("quote_messages"."sender" IN ('customer', 'admin'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quote_parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"file_name" text NOT NULL,
	"source_key" text NOT NULL,
	"source_format" text NOT NULL,
	"source_bytes" bigint NOT NULL,
	"source_sha256" text NOT NULL,
	"upload_id" text,
	"analysis_status" text DEFAULT 'queued' NOT NULL,
	"analysis_attempt" integer DEFAULT 0 NOT NULL,
	"analysis_error" text,
	"geometry" jsonb,
	"canonical_stl_key" text,
	"preview_glb_key" text,
	"thumbnail_key" text,
	"units" text DEFAULT 'mm' NOT NULL,
	"scale" double precision DEFAULT 1 NOT NULL,
	"technology_key" text NOT NULL,
	"material_key" text NOT NULL,
	"color_key" text NOT NULL,
	"finish_key" text NOT NULL,
	"layer_um" integer,
	"infill_pct" integer,
	"quantity" integer DEFAULT 1 NOT NULL,
	"note" text,
	"drawing_key" text,
	"drawing_name" text,
	"critical_tolerance" boolean DEFAULT false NOT NULL,
	"dfm_ack_key" text,
	"manual_unit_price_kurus" integer,
	"manual_price_key" text,
	"manual_priced_at" timestamp with time zone,
	"manual_priced_by_email" text,
	"target_unit_price_kurus" integer,
	"deleted_at" timestamp with time zone,
	"files_purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_parts_source_format_chk" CHECK ("quote_parts"."source_format" IN ('stl', 'obj', '3mf')),
	CONSTRAINT "quote_parts_analysis_status_chk" CHECK ("quote_parts"."analysis_status" IN ('queued', 'analyzing', 'ready', 'failed')),
	CONSTRAINT "quote_parts_units_chk" CHECK ("quote_parts"."units" IN ('mm', 'cm', 'in')),
	CONSTRAINT "quote_parts_quantity_chk" CHECK ("quote_parts"."quantity" BETWEEN 1 AND 100000),
	CONSTRAINT "quote_parts_scale_chk" CHECK ("quote_parts"."scale" > 0.0099 AND "quote_parts"."scale" < 100.01)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quote_pricing_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"qty_breaks" jsonb NOT NULL,
	"lead_tiers" jsonb NOT NULL,
	"min_order_kurus" integer NOT NULL,
	"max_auto_total_kurus" integer NOT NULL,
	"max_auto_qty_per_part" integer NOT NULL,
	"max_parts_per_quote" integer NOT NULL,
	"max_file_bytes" integer NOT NULL,
	"quote_valid_days" integer NOT NULL,
	"retention_days_after_expiry" integer NOT NULL,
	"price_break_quantities" jsonb NOT NULL,
	"holidays" jsonb NOT NULL,
	"cutoff_hour" integer NOT NULL,
	"havale_discount_applies" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "quote_pricing_settings_singleton_chk" CHECK ("quote_pricing_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "quotes_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"number" text GENERATED ALWAYS AS ('T-' || lpad(seq::text, greatest(6, length(seq::text)), '0')) STORED NOT NULL,
	"user_id" uuid,
	"anonymous_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"review_kind" text,
	"review_note" text,
	"review_requested_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_email" text,
	"title" text,
	"lead_tier" text DEFAULT 'standard' NOT NULL,
	"addon_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"customer_note" text,
	"po_number" text,
	"invoice_type" text DEFAULT 'individual' NOT NULL,
	"company_name" text,
	"tax_id" text,
	"tax_id_type" text,
	"tax_office" text,
	"billing_address" jsonb,
	"pricing_snapshot" jsonb NOT NULL,
	"snapshot_taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"total_kurus" integer,
	"lead_days" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"share_token" text,
	"terms_accepted_at" timestamp with time zone,
	"terms_version" text,
	"order_id" uuid,
	"source_quote_id" uuid,
	"expiry_reminder_sent_at" timestamp with time zone,
	"abandoned_reminder_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_seq_unique" UNIQUE("seq"),
	CONSTRAINT "quotes_number_unique" UNIQUE("number"),
	CONSTRAINT "quotes_status_chk" CHECK ("quotes"."status" IN ('draft', 'needs_review', 'quoted', 'ordered', 'expired', 'cancelled')),
	CONSTRAINT "quotes_review_kind_chk" CHECK ("quotes"."review_kind" IS NULL OR "quotes"."review_kind" IN ('manual', 'rfq', 'target_price')),
	CONSTRAINT "quotes_lead_tier_chk" CHECK ("quotes"."lead_tier" IN ('economy', 'standard', 'express')),
	CONSTRAINT "quotes_invoice_type_chk" CHECK ("quotes"."invoice_type" IN ('individual', 'corporate')),
	CONSTRAINT "quotes_tax_id_type_chk" CHECK ("quotes"."tax_id_type" IS NULL OR "quotes"."tax_id_type" IN ('vkn', 'tckn'))
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.print_finishes'::regclass AND conname = 'print_finishes_technology_id_print_technologies_id_fk') THEN
    ALTER TABLE "print_finishes" ADD CONSTRAINT "print_finishes_technology_id_print_technologies_id_fk" FOREIGN KEY ("technology_id") REFERENCES "public"."print_technologies"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.print_materials'::regclass AND conname = 'print_materials_technology_id_print_technologies_id_fk') THEN
    ALTER TABLE "print_materials" ADD CONSTRAINT "print_materials_technology_id_print_technologies_id_fk" FOREIGN KEY ("technology_id") REFERENCES "public"."print_technologies"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.quote_admin_actions'::regclass AND conname = 'quote_admin_actions_quote_id_quotes_id_fk') THEN
    ALTER TABLE "quote_admin_actions" ADD CONSTRAINT "quote_admin_actions_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.quote_admin_actions'::regclass AND conname = 'quote_admin_actions_quote_part_id_quote_parts_id_fk') THEN
    ALTER TABLE "quote_admin_actions" ADD CONSTRAINT "quote_admin_actions_quote_part_id_quote_parts_id_fk" FOREIGN KEY ("quote_part_id") REFERENCES "public"."quote_parts"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.quote_checkouts'::regclass AND conname = 'quote_checkouts_quote_id_quotes_id_fk') THEN
    ALTER TABLE "quote_checkouts" ADD CONSTRAINT "quote_checkouts_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.quote_checkouts'::regclass AND conname = 'quote_checkouts_draft_id_order_drafts_id_fk') THEN
    ALTER TABLE "quote_checkouts" ADD CONSTRAINT "quote_checkouts_draft_id_order_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."order_drafts"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.quote_messages'::regclass AND conname = 'quote_messages_quote_id_quotes_id_fk') THEN
    ALTER TABLE "quote_messages" ADD CONSTRAINT "quote_messages_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.quote_messages'::regclass AND conname = 'quote_messages_sender_user_id_users_id_fk') THEN
    ALTER TABLE "quote_messages" ADD CONSTRAINT "quote_messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.quote_parts'::regclass AND conname = 'quote_parts_quote_id_quotes_id_fk') THEN
    ALTER TABLE "quote_parts" ADD CONSTRAINT "quote_parts_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.quotes'::regclass AND conname = 'quotes_user_id_users_id_fk') THEN
    ALTER TABLE "quotes" ADD CONSTRAINT "quotes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.quotes'::regclass AND conname = 'quotes_order_id_orders_id_fk') THEN
    ALTER TABLE "quotes" ADD CONSTRAINT "quotes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.quotes'::regclass AND conname = 'quotes_source_quote_id_quotes_id_fk') THEN
    ALTER TABLE "quotes" ADD CONSTRAINT "quotes_source_quote_id_quotes_id_fk" FOREIGN KEY ("source_quote_id") REFERENCES "public"."quotes"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "print_materials_tech_key_uq" ON "print_materials" USING btree ("technology_id","key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quote_checkouts_draft_id_uq" ON "quote_checkouts" USING btree ("draft_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_checkouts_quote_idx" ON "quote_checkouts" USING btree ("quote_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_messages_quote_idx" ON "quote_messages" USING btree ("quote_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quote_parts_upload_id_uq" ON "quote_parts" USING btree ("upload_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_parts_quote_idx" ON "quote_parts" USING btree ("quote_id","sort_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_parts_sha_idx" ON "quote_parts" USING btree ("source_sha256");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quotes_share_token_uq" ON "quotes" USING btree ("share_token");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quotes_order_id_uq" ON "quotes" USING btree ("order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quotes_user_idx" ON "quotes" USING btree ("user_id","created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quotes_anon_idx" ON "quotes" USING btree ("anonymous_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quotes_status_idx" ON "quotes" USING btree ("status","review_requested_at");
--> statement-breakpoint
-- Başlangıç kataloğu. Sabit uuid'ler: down ve testler tohumu hedefleyebilir.
-- `ON CONFLICT DO NOTHING` sayesinde yeniden çalıştırma admin düzenlemelerini
-- ezmez. Tüm para alanları kuruş; fiyatlar KDV dahildir.
INSERT INTO "print_technologies" ("id", "key", "name", "description", "order_material", "capability_tag", "build_x_mm", "build_y_mm", "build_z_mm", "min_wall_mm", "min_feature_mm", "tolerance_text", "layer_options_um", "default_layer_um", "infill_options_pct", "default_infill_pct", "shell_mm", "setup_fee_kurus", "machine_rate_kurus_per_hour", "throughput_cm3_per_hour", "height_hours_per_mm", "min_unit_price_kurus", "base_lead_days", "sort_order") VALUES
	('00000000-0000-4000-8000-000000000f01', 'fdm', 'FDM (Filament)', 'Eriyik yığma; dayanıklı prototip ve fonksiyonel parçalar', 'filament', 'material_filament', 250, 210, 210, 0.8, 0.4, '±%0,5 (en az ±0,5 mm)', '[100,200,300]'::jsonb, 200, '[15,20,30,50,100]'::jsonb, 20, 1.2, 2500, 6000, 12, 0.002, 4900, 3, 0),
	('00000000-0000-4000-8000-000000000f02', 'sla', 'SLA (Reçine)', 'Reçine; yüksek detay ve pürüzsüz yüzey', 'resin', 'material_resin', 218, 122, 220, 0.6, 0.3, '±%0,2 (en az ±0,15 mm)', '[50,100]'::jsonb, 50, NULL, NULL, 0, 3500, 4000, 40, 0.03, 7900, 4, 1)
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "print_materials" ("id", "technology_id", "key", "name", "description", "properties", "density_g_cm3", "price_kurus_per_gram", "support_factor", "capability_tag", "colors", "lead_days_extra", "sort_order") VALUES
	('00000000-0000-4000-8000-000000000f11', '00000000-0000-4000-8000-000000000f01', 'pla', 'PLA', 'Kolay basılan çok amaçlı filament; maket, dekor ve görsel prototipler için.', '{"tensileMpa":50,"heatDeflectionC":55,"uses":["prototip","maket","dekor"]}'::jsonb, 1.24, 150, 1.10, NULL, '[{"key":"beyaz","name":"Beyaz","hex":"#F5F5F5","surchargeKurus":0},{"key":"siyah","name":"Siyah","hex":"#1A1A1A","surchargeKurus":0},{"key":"gri","name":"Gri","hex":"#8A8D91","surchargeKurus":0},{"key":"kirmizi","name":"Kırmızı","hex":"#C62828","surchargeKurus":0},{"key":"mavi","name":"Mavi","hex":"#1565C0","surchargeKurus":0},{"key":"yesil","name":"Yeşil","hex":"#2E7D32","surchargeKurus":0},{"key":"sari","name":"Sarı","hex":"#F9A825","surchargeKurus":0}]'::jsonb, 0, 0),
	('00000000-0000-4000-8000-000000000f12', '00000000-0000-4000-8000-000000000f01', 'petg', 'PETG', 'Neme ve darbeye dayanıklı; fonksiyonel parça ve muhafazalar için.', '{"tensileMpa":50,"heatDeflectionC":70,"uses":["fonksiyonel parça","muhafaza","dış mekân"]}'::jsonb, 1.27, 170, 1.10, 'pmat_petg', '[{"key":"siyah","name":"Siyah","hex":"#1A1A1A","surchargeKurus":0},{"key":"beyaz","name":"Beyaz","hex":"#F5F5F5","surchargeKurus":0},{"key":"seffaf","name":"Şeffaf","hex":"#DDEEEE","surchargeKurus":500}]'::jsonb, 0, 1),
	('00000000-0000-4000-8000-000000000f13', '00000000-0000-4000-8000-000000000f01', 'abs', 'ABS', 'Isıya dayanıklı mühendislik plastiği; mekanik parça ve kutular için.', '{"tensileMpa":40,"heatDeflectionC":98,"uses":["mekanik parça","kutu","otomotiv içi parça"]}'::jsonb, 1.04, 170, 1.10, 'pmat_abs', '[{"key":"siyah","name":"Siyah","hex":"#1A1A1A","surchargeKurus":0},{"key":"beyaz","name":"Beyaz","hex":"#F5F5F5","surchargeKurus":0}]'::jsonb, 0, 2),
	('00000000-0000-4000-8000-000000000f14', '00000000-0000-4000-8000-000000000f01', 'tpu95a', 'TPU 95A (esnek)', 'Kauçuk benzeri esnek filament; conta, tampon ve tutamaklar için.', '{"tensileMpa":30,"elongationPct":500,"flexible":true,"uses":["conta","tampon","esnek kılıf"]}'::jsonb, 1.21, 280, 1.10, 'pmat_tpu', '[{"key":"siyah","name":"Siyah","hex":"#1A1A1A","surchargeKurus":0},{"key":"beyaz","name":"Beyaz","hex":"#F5F5F5","surchargeKurus":0}]'::jsonb, 1, 3),
	('00000000-0000-4000-8000-000000000f15', '00000000-0000-4000-8000-000000000f02', 'standard_resin', 'Standart reçine', 'Yüksek detay ve pürüzsüz yüzey; figür, maket ve görsel prototipler için.', '{"tensileMpa":50,"heatDeflectionC":50,"uses":["figür","maket","görsel prototip"]}'::jsonb, 1.15, 300, 1.15, NULL, '[{"key":"gri","name":"Gri","hex":"#9E9E9E","surchargeKurus":0},{"key":"beyaz","name":"Beyaz","hex":"#FAFAFA","surchargeKurus":0},{"key":"siyah","name":"Siyah","hex":"#212121","surchargeKurus":0},{"key":"seffaf","name":"Şeffaf","hex":"#E3F2FD","surchargeKurus":1000}]'::jsonb, 0, 4),
	('00000000-0000-4000-8000-000000000f16', '00000000-0000-4000-8000-000000000f02', 'tough_resin', 'Dayanıklı reçine (ABS benzeri)', 'Darbeye dayanıklı reçine; geçmeli ve fonksiyonel prototipler için.', '{"tensileMpa":55,"elongationPct":20,"heatDeflectionC":60,"uses":["geçmeli parça","fonksiyonel prototip","mekanik test"]}'::jsonb, 1.18, 450, 1.15, 'pmat_tough_resin', '[{"key":"gri","name":"Gri","hex":"#9E9E9E","surchargeKurus":0}]'::jsonb, 1, 5),
	('00000000-0000-4000-8000-000000000f17', '00000000-0000-4000-8000-000000000f02', 'flex_resin', 'Esnek reçine', 'Yumuşak ve esnek reçine; conta, tutamak ve sönümleyici parçalar için.', '{"tensileMpa":8,"elongationPct":80,"flexible":true,"uses":["conta","tutamak","sönümleyici"]}'::jsonb, 1.10, 550, 1.15, 'pmat_flex_resin', '[{"key":"siyah","name":"Siyah","hex":"#212121","surchargeKurus":0}]'::jsonb, 1, 6)
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "print_finishes" ("id", "technology_id", "key", "name", "description", "fixed_kurus", "per_cm2_kurus", "lead_days_extra", "requires_manual", "cost_line_kind", "sort_order") VALUES
	('00000000-0000-4000-8000-000000000f21', NULL, 'ham', 'Standart (destekler alınmış)', 'Destekler alınır, katman izleri görünür kalır.', 0, 0, 0, false, 'production', 0),
	('00000000-0000-4000-8000-000000000f22', NULL, 'zimpara', 'Zımparalı', 'Yüzey zımparalanır; katman izleri belirgin şekilde azalır.', 1500, 20, 1, false, 'production', 1),
	('00000000-0000-4000-8000-000000000f23', NULL, 'astar', 'Astarlı (boyaya hazır)', 'Zımpara sonrası astar uygulanır; parça boyaya hazır teslim edilir.', 2500, 35, 2, false, 'production', 2),
	('00000000-0000-4000-8000-000000000f24', NULL, 'boyali', 'Boyalı (RAL)', 'İstediğiniz RAL rengine boyanır; fiyatı ekibimiz belirler.', 0, 0, 3, true, 'painting', 3),
	('00000000-0000-4000-8000-000000000f25', NULL, 'ozel', 'Özel ardıl işlem', 'Vernik, kaplama gibi özel istekler; ekibimiz fiyatlandırır.', 0, 0, 2, true, 'production', 4)
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "print_addons" ("id", "key", "name", "description", "price_type", "price_kurus", "lead_days_extra", "sort_order") VALUES
	('00000000-0000-4000-8000-000000000f31', 'uygunluk_sertifikasi', 'Uygunluk sertifikası', 'Siparişin sipariş edilen şartlara uygun üretildiğini belgeleyen yazı.', 'fixed', 35000, 0, 0),
	('00000000-0000-4000-8000-000000000f32', 'olcum_raporu', 'Standart ölçüm raporu', 'Kritik ölçülerin kumpasla kontrol edildiği ölçüm raporu.', 'fixed', 125000, 1, 1),
	('00000000-0000-4000-8000-000000000f33', 'malzeme_veri_sayfasi', 'Malzeme veri sayfası', 'Kullanılan malzemenin üretici teknik veri sayfası.', 'fixed', 15000, 0, 2),
	('00000000-0000-4000-8000-000000000f34', 'rohs_beyani', 'RoHS uygunluk beyanı', 'Kullanılan malzemenin RoHS kısıtlı maddelere uygunluk beyanı.', 'fixed', 25000, 1, 3)
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Tek satırlık politika. Tatiller 2026–2027 TR resmi tatilleri; dini bayram
-- tarihleri admin tarafından Diyanet takvimiyle doğrulanmalı.
INSERT INTO "quote_pricing_settings" ("id", "qty_breaks", "lead_tiers", "min_order_kurus", "max_auto_total_kurus", "max_auto_qty_per_part", "max_parts_per_quote", "max_file_bytes", "quote_valid_days", "retention_days_after_expiry", "price_break_quantities", "holidays", "cutoff_hour", "havale_discount_applies") VALUES
	(1,
	'[{"minQty":1,"discountBps":0},{"minQty":5,"discountBps":500},{"minQty":10,"discountBps":1000},{"minQty":25,"discountBps":1500},{"minQty":50,"discountBps":2000},{"minQty":100,"discountBps":2500},{"minQty":500,"discountBps":3000}]'::jsonb,
	'[{"key":"economy","name":"Ekonomik","multiplierBps":9000,"daysDelta":3,"minDays":5},{"key":"standard","name":"Standart","multiplierBps":10000,"daysDelta":0,"minDays":3},{"key":"express","name":"Ekspres","multiplierBps":14000,"daysDelta":-2,"minDays":2}]'::jsonb,
	20000, 10000000, 1000, 20, 33554432, 30, 90,
	'[1,5,10,25,50,100]'::jsonb,
	'["2026-01-01","2026-03-20","2026-03-21","2026-03-22","2026-04-23","2026-05-01","2026-05-19","2026-05-27","2026-05-28","2026-05-29","2026-05-30","2026-07-15","2026-08-30","2026-10-29","2027-01-01","2027-03-09","2027-03-10","2027-03-11","2027-04-23","2027-05-01","2027-05-16","2027-05-17","2027-05-18","2027-05-19","2027-07-15","2027-08-30","2027-10-29"]'::jsonb,
	14, true)
ON CONFLICT DO NOTHING;
