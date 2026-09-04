-- 0051 geri alma.
--
-- DİKKAT — `carrier` enum'undaki 'elden' değeri BİLEREK BIRAKILIR. PostgreSQL
-- bir enum'dan değer düşüremez; ayrıca o değeri yazmış sipariş satırları varsa
-- düşürmek veri kaybı olurdu. Zararsız bir artıktır.
--
-- Tablolar sırayla düşer: participants → sessions → venues (FK yönü).
-- Yalnızca up'ın eklediklerini kaldırır. Tekrar çalıştırılabilir (IF EXISTS).
SET lock_timeout = '5s';
ALTER TABLE "orders" DROP COLUMN IF EXISTS "workshop_session_id";
DROP TABLE IF EXISTS "workshop_participants";
DROP TABLE IF EXISTS "workshop_sessions";
DROP INDEX IF EXISTS "workshop_venues_request_id_unique_idx";
DROP TABLE IF EXISTS "workshop_venues";
DROP TYPE IF EXISTS "workshop_session_status";
