-- 0054 — atama kararı GEÇMİŞİ: değerlendirme satırları artık EKLENİR.
--
-- `manufacturer_assignment_evaluations` üzerindeki UNIQUE (order_id,
-- weights_version) indeksi sipariş + karşılaştırma başına TEK satıra izin
-- veriyordu. Yazıcı da çakışmayı `onConflictDoUpdate` ile çözmek zorundaydı:
-- bir siparişin İKİNCİ yerleştirmesi (geri al + yeniden atama, ret sonrası
-- yeniden atama) BİRİNCİNİN kaydını siliyordu. Sonuç: her siparişte her zaman
-- tam olarak bir karar duruyor, admin kartındaki "Önceki atama kararları"
-- bölümü hiçbir koşulda dolmuyor ve ilk kararın kimi seçtiği geri alınamaz
-- biçimde kayboluyordu.
--
-- Tekillik kalkıyor; yerine okuma desenlerini besleyen iki NORMAL indeks var:
--   * (order_id, created_at) — sipariş detayı: bu siparişin son N kararı.
--   * (created_at)           — değerlendirme listesi (son 400 kayıt) ve 30
--                              günden eski satırları silen saklama worker'ı.
-- Artan btree, DESC sıralamayı geriye tarayarak karşılar; ayrı bir DESC indekse
-- gerek yok.
--
-- VERİ KAYBI YOK: yalnız indeksler değişir, satırlara dokunulmaz. Tekil indeks
-- düşerken tuttuğu veri de yoktur (tekillik bir kısıttır, kayıt değil).
--
-- Idempotent: bir kez uygulanmış bir veritabanında yeniden çalıştırılabilir.
SET lock_timeout = '5s';
--> statement-breakpoint
DROP INDEX IF EXISTS "mfg_eval_order_version_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mfg_eval_order_created_idx" ON "manufacturer_assignment_evaluations" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mfg_eval_created_idx" ON "manufacturer_assignment_evaluations" USING btree ("created_at");
