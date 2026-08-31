-- 0049 geri alma. Yalnızca up'ın oluşturduğu tabloyu ve tipleri düşürür;
-- başka hiçbir veriye dokunmaz. Tekrar çalıştırılabilir.
-- Tablo düşünce indeksler ve FK'ler de birlikte gider.
DROP TABLE IF EXISTS "consumer_requests";
DROP TYPE IF EXISTS "public"."consumer_request_status";
DROP TYPE IF EXISTS "public"."consumer_request_type";
