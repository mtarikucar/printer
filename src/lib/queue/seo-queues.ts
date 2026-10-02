/**
 * Arama motoru bildirimlerinin kuyruğu.
 *
 * AYRI dosya: `queues.ts` başka bir oturumun çalışmasını taşıyor ve
 * düzenlenmiyor, `quote-queues.ts` ise adıyla anlık teklif motorunun kuyrukları
 * — SEO turunu oraya sokmak o dosyanın anlamını kirletirdi. Bağlantı ve kurulum
 * deseni ikisiyle de birebir aynıdır (tembel `Queue`, paylaşılan ioredis
 * bağlantısı).
 *
 * NOT: `import "server-only"` YOK — bu modülü BullMQ worker süreci de yükler.
 */
import { Queue } from "bullmq";
import { getRedisConnection } from "./connection";

export const SEO_INDEXNOW_QUEUE = "seo-indexnow";

/**
 * İki deneme (ikincisi 10 sn sonra): IndexNow turu bir HTTP çağrısıdır ve geçici
 * bir ağ hatası bir sayfanın duyurulmamasına yetmemeli. Tur idempotent — hafıza
 * ancak BAŞARILI gönderimden sonra yazılıyor, yani ikinci deneme aynı farkı
 * gönderir.
 *
 * Saklanan iş sayısı küçük (50): bu kuyruk saatte bir koşuyor ve iz yalnız
 * "duyuru gitti mi" sorusunu yanıtlamak için gerekiyor.
 */
const DEFAULT_JOB_OPTIONS = {
  attempts: 2,
  backoff: { type: "exponential" as const, delay: 10_000 },
  removeOnComplete: { count: 50 },
  removeOnFail: { count: 50 },
};

let indexNowQueue: Queue | null = null;

export function getSeoIndexNowQueue(): Queue {
  if (!indexNowQueue) {
    indexNowQueue = new Queue(SEO_INDEXNOW_QUEUE, {
      connection: getRedisConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }
  return indexNowQueue;
}
