-- 0057 — boyacı atama KARAR KAYDI (`painter_assignment_evaluations`).
--
-- Faz 4 boyacıyı otomatik seçiyor: üretici QC'si onaylandığında rota, yük,
-- güvenilirlik, QC kalitesi ve zamanında teslim skorlanıp iş bir boyacıya
-- veriliyor; ret ya da 24 saat cevapsızlık halinde sıradaki boyacıya
-- geçiliyor. Ortağın geliri bu karara bağlı olduğu için kararın kendisi
-- kaydedilmek zorunda: "neden ben değil" sorusu siparişin BUGÜNKÜ hâline
-- bakarak değil, yalnız karar anında yazılmış bir satırdan cevaplanabilir.
--
-- NEDEN YENİ TABLO, `manufacturer_assignment_evaluations` DEĞİL: o tablo bir
-- A/B düellosunun şeklini taşıyor (v1/v2 kazanan sütunları + `authoritative`),
-- çünkü orada iki profil yarışıyor. Boyacı sıralayıcısının tek ağırlık kümesi
-- var; oraya sığdırmak bir kazanan sütununu sonsuza kadar boş bırakmak, iki
-- farklı kararı aynı ekranda karıştırmak ve üreticinin saklama temizliğini
-- boyacı satırlarına da uygulamak demekti.
--
-- İKİ SÜTUN, ÜRETİCİ TABLOSUNDAN ÖĞRENİLEN DERSLE VAR:
--   * `placed_painter_id` — sıralamanın birincisi ile işi GERÇEKTEN alan
--     boyacı aynı olmak zorunda değil (yönetici elle başkasını seçebilir).
--     Üretici tarafında bunun sütunu yoktu; yerleşen ancak jsonb damgasından
--     okunabiliyordu, oysa satırın bütün anlamı "şu karar şu boyacıya gitti".
--   * `excluded_painter_ids` — bu denemede sıralamaya hiç sokulmayanlar
--     (önceki retler, cevapsız kalan SLA). Ret hakkının geçmişi (DÖRT ret: üç
--     yeniden yerleştirme + işlenmekte olan ret) buradan okunur; "en yakın
--     boyacı neden hiç görünmüyor" sorusunun tek cevabı bu.
--
-- TEKİL İNDEKS YOK, BİLEREK. Üretici tablosunda (order_id, weights_version)
-- tekildi ve aynı siparişin İKİNCİ kararı birincinin üstüne yazıyordu; karar
-- geçmişi hiç oluşmuyordu (migration 0054 bunu düzeltti). Ret sonrası yeniden
-- yerleştirme burada KURALIN KENDİSİ olduğu için tekillik hiç kurulmuyor:
-- her karar kendi satırını EKLER.
--
-- `trigger` bir pg enum DEĞİL, `text`. ALTI değer var (tek kaynak:
-- services/painter-evaluation.ts · PAINTER_ASSIGNMENT_TRIGGERS): qc_approve |
-- decline_retry | sla_reassign | admin_manual | manufacturer_handoff |
-- admin_swap. Yeni bir tetikleyici eklemek migration istemesin ve geri alma
-- çifti temiz kaldırabilsin diye (kaldırılabilmesi gereken bir şey için pg
-- enum'a değer eklenmez).
--
-- Kısıtlar CREATE TABLE'ın İÇİNDE: ayrı bir ALTER ... ADD CONSTRAINT idempotent
-- olmazdı (PostgreSQL'de ADD CONSTRAINT IF NOT EXISTS yoktur); tabloyla
-- birlikte tanımlanınca IF NOT EXISTS tamamını kapsar. Kısıt ADLARI elle
-- yazılıyor ve drizzle'ın anlık görüntüsündeki (meta/0057_snapshot.json)
-- adlarla birebir aynı; ayrışsalardı sonraki `drizzle-kit generate` farkı
-- "eksik kısıt" sanıp gereksiz bir migration üretirdi.
--
-- `order_id` ON DELETE cascade: satır siparişin telemetrisidir, sipariş
-- silinince yaşamasının anlamı yok. Boyacı FK'leri ise NO ACTION — bir kararın
-- kime gittiği, o boyacı sonradan silinse bile silinmemeli (ve silinemez).
--
-- Idempotent: bir kez uygulanmış bir veritabanında yeniden çalıştırılabilir.
SET lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "painter_assignment_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"winner_painter_id" uuid,
	"placed_painter_id" uuid,
	"candidates" jsonb,
	"excluded_painter_ids" jsonb,
	"weights_version" text NOT NULL,
	"trigger" text NOT NULL,
	"outcome_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "painter_assignment_evaluations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "painter_assignment_evaluations_winner_painter_id_painters_id_fk" FOREIGN KEY ("winner_painter_id") REFERENCES "public"."painters"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "painter_assignment_evaluations_placed_painter_id_painters_id_fk" FOREIGN KEY ("placed_painter_id") REFERENCES "public"."painters"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
-- Sipariş detayı: "bu siparişin son kararları", zamana göre. Artan btree DESC
-- sıralamayı geriye tarayarak karşılar; ayrı bir DESC indekse gerek yok.
CREATE INDEX IF NOT EXISTS "painter_eval_order_created_idx" ON "painter_assignment_evaluations" USING btree ("order_id","created_at");--> statement-breakpoint
-- Değerlendirme listesi + 30 günlük SAKLAMA temizliği (scoring-evaluations-cleanup
-- worker'ı `created_at < cutoff` siler). İndeks olmasa temizlik her gün tam
-- tarama yapardı.
CREATE INDEX IF NOT EXISTS "painter_eval_created_idx" ON "painter_assignment_evaluations" USING btree ("created_at");
