-- 0056 — partner ↔ yönetici sipariş sohbeti (bugün BOYACI kanalı).
--
-- Faz 2, boyacı ile yönetici arasına sipariş bazlı bir yazışma kanalı koyuyor:
-- elindeki baskı eski sürüme ait olabilen boyacının soracağı yer, e-posta
-- değil, işin kendi ekranı olmalı.
--
-- NEDEN YENİ TABLO, `messages` DEĞİL: `messages.channel` ve
-- `messages.sender_type` birer pg ENUM. "painter_admin" / "painter"
-- değerlerini oraya eklemek, bu dosyanın geri alma çiftinin TEMİZ
-- kaldıramayacağı iki enum değeri demekti (bir pg enum'dan değer düşürmek
-- tipin yeniden yazılmasını gerektirir). Faz 2 kuralı nettir: kaldırılabilmesi
-- gereken bir şey için enum'a değer eklenmez. Kanal bu yüzden `text`
-- ayırıcıları olan kendi tablosunda yaşıyor — yeni bir partner türü (üretici
-- kanalı) eklemek artık migration istemez.
--
-- `partner_id`de FK YOK: `partner_type`a göre painters ya da manufacturers'ı
-- gösterir ve tek kolon iki tabloya birden FK veremez. Bütünlüğü, kanalı açan
-- rotanın oturum kimliği sağlar (partner kendi id'sinden başkasını yazamaz).
-- `order_id` FK'si ise CREATE TABLE'ın İÇİNDE: ayrı bir ALTER ... ADD
-- CONSTRAINT idempotent olmazdı (PostgreSQL'de ADD CONSTRAINT IF NOT EXISTS
-- yoktur), tablo ile birlikte tanımlanınca IF NOT EXISTS tamamını kapsar.
-- Kısıt ADI elle yazılıyor: adsız bırakılsaydı PostgreSQL ona
-- `order_partner_messages_order_id_fkey` derdi, oysa drizzle'ın anlık
-- görüntüsü (meta/0056_snapshot.json) `..._order_id_orders_id_fk` adını
-- taşıyor. İki ad ayrışınca sonraki `drizzle-kit generate` farkı "eksik kısıt"
-- gibi okur ve gereksiz bir migration üretir.
--
-- Idempotent: bir kez uygulanmış bir veritabanında yeniden çalıştırılabilir.
SET lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "order_partner_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"partner_type" text NOT NULL,
	"partner_id" uuid NOT NULL,
	"sender" text NOT NULL,
	"sender_email" text,
	"body" text NOT NULL,
	"read_by_admin_at" timestamp,
	"read_by_partner_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "order_partner_messages_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
-- Ekranın tek sorgusu: "bu siparişte, bu partner türünde, zaman sırasına göre".
CREATE INDEX IF NOT EXISTS "order_partner_messages_order_idx" ON "order_partner_messages" USING btree ("order_id","partner_type","created_at");
