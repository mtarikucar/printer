-- 0053 — sipariş başına çok dosyalı model.
--
-- Bir sipariş tek bir model değil, bir dosya KÜMESİdir: bazı işler 12-13 ayrı
-- parçadan oluşuyor (ZIP olarak yükleniyor). Her yükleme bir sürüm açar ve o
-- sürümün tüm dosyaları `order_model_files`'a yazılır. Sürüm başlığı ve
-- siparişin canlı model kolonları geriye dönük uyumluluk için BİRİNCİL dosyayı
-- gösterir.
--
-- GLB artık zorunlu değil: yalnız STL (baskı) ya da yalnız GLB (görüntüleme)
-- geçerli bir yüklemedir → order_model_revisions.glb_key/glb_url NULL olabilir.
--
-- Mevcut her sürümün GLB/STL'si dosya tablosuna geri doldurulur (backfill); böylece
-- okuyan her yer tek bir kaynağa bakabilir. Ekleme idempotenttir (NOT EXISTS).
--
-- DROP NOT NULL yalnız katalog günceller, tabloyu yeniden yazmaz; yine de kısa
-- süreli ACCESS EXCLUSIVE kilit ister — kilit alınamazsa hızlı başarısız olsun.
--
-- Idempotent: bir kez uygulanmış bir veritabanında yeniden çalıştırılabilir.
SET lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "order_model_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"kind" text NOT NULL,
	"file_key" text NOT NULL,
	"file_name" text NOT NULL,
	"size_bytes" bigint,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_model_revisions" ALTER COLUMN "glb_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "order_model_revisions" ALTER COLUMN "glb_url" DROP NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "order_model_files" ADD CONSTRAINT "order_model_files_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_model_files_order_rev_idx" ON "order_model_files" USING btree ("order_id","revision","sort_order");--> statement-breakpoint
-- Backfill: mevcut sürümlerin birincil GLB'si ve STL'si. Tür bazında NOT EXISTS:
-- aynı sürüm için az önce eklenen GLB satırı STL eklemeyi engellemesin.
INSERT INTO "order_model_files" ("order_id", "revision", "kind", "file_key", "file_name", "sort_order", "created_at")
SELECT r."order_id", r."revision", 'glb', r."glb_key", 'model.glb', 0, r."created_at"
FROM "order_model_revisions" r
WHERE r."glb_key" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "order_model_files" f
    WHERE f."order_id" = r."order_id" AND f."revision" = r."revision" AND f."kind" = 'glb'
  );--> statement-breakpoint
INSERT INTO "order_model_files" ("order_id", "revision", "kind", "file_key", "file_name", "sort_order", "created_at")
SELECT r."order_id", r."revision", 'stl', r."stl_key", 'model.stl', 1, r."created_at"
FROM "order_model_revisions" r
WHERE r."stl_key" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "order_model_files" f
    WHERE f."order_id" = r."order_id" AND f."revision" = r."revision" AND f."kind" = 'stl'
  );
