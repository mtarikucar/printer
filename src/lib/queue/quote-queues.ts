/**
 * Anlık teklif motorunun kuyrukları.
 *
 * AYRI dosya: `src/lib/queue/queues.ts` başka bir oturumun commit'lenmemiş
 * çalışmasını taşıyor ve düzenlenemez. Bağlantı ve kurulum deseni oradakiyle
 * birebir aynıdır (tembel `Queue`, paylaşılan ioredis bağlantısı).
 *
 * NOT: `import "server-only"` YOK — bu modülü BullMQ worker süreci de yükler.
 *
 * İŞ KİMLİKLERİNDE İKİ NOKTA YOK. bullmq 5.70.1 özel bir iş kimliğinde `:`
 * kullanımına yalnız tam üç parçaya bölündüğünde izin verir, aksi hâlde
 * `Custom Id cannot contain :` atar. Bu yüzden her kimlik tire ile kurulur.
 */
import { Queue } from "bullmq";
import { getRedisConnection } from "./connection";

export const QUOTE_ANALYSIS_QUEUE = "quote-part-analysis";
export const QUOTE_ORDER_FILES_QUEUE = "quote-order-files";
export const QUOTE_MAINTENANCE_QUEUE = "quote-maintenance";

/** Tek bir parçanın geometri analizi (python). */
export interface QuotePartAnalysisJob {
  partId: string;
}

/** Ödenen teklifin parça dosyalarını siparişe pişirir (Task 4.2). */
export interface QuoteOrderFilesJob {
  orderId: string;
  quoteId: string;
}

/**
 * Üç kuyruğun ortak iş varsayılanları: iki deneme (ikincisi 10 sn sonra),
 * tamamlanan/başarısız işlerden son 500'ü saklanır — bir müşteri "fiyatım
 * neden çıkmadı" diye sorduğunda iz elde kalsın diye.
 */
const DEFAULT_JOB_OPTIONS = {
  attempts: 2,
  backoff: { type: "exponential" as const, delay: 10_000 },
  removeOnComplete: { count: 500 },
  removeOnFail: { count: 500 },
};

let analysisQueue: Queue<QuotePartAnalysisJob> | null = null;
let orderFilesQueue: Queue<QuoteOrderFilesJob> | null = null;
let maintenanceQueue: Queue | null = null;

export function getQuoteAnalysisQueue(): Queue<QuotePartAnalysisJob> {
  if (!analysisQueue) {
    analysisQueue = new Queue<QuotePartAnalysisJob>(QUOTE_ANALYSIS_QUEUE, {
      connection: getRedisConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }
  return analysisQueue;
}

export function getQuoteOrderFilesQueue(): Queue<QuoteOrderFilesJob> {
  if (!orderFilesQueue) {
    orderFilesQueue = new Queue<QuoteOrderFilesJob>(QUOTE_ORDER_FILES_QUEUE, {
      connection: getRedisConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }
  return orderFilesQueue;
}

export function getQuoteMaintenanceQueue(): Queue {
  if (!maintenanceQueue) {
    maintenanceQueue = new Queue(QUOTE_MAINTENANCE_QUEUE, {
      connection: getRedisConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }
  return maintenanceQueue;
}

/**
 * Parçayı analiz kuyruğuna alır.
 *
 * `attempt` iş kimliğinin parçasıdır ve ÇAĞIRANIN SÖZLEŞMESİDİR: bullmq,
 * saklanan (tamamlanmış ya da başarısız) bir işin kimliğiyle gelen ikinci
 * eklemeyi hata vermeden YUTAR — `add()` var olan işi döndürür, yeni iş
 * çalışmaz. Bu yüzden her ekleme, o parça için daha önce KULLANILMAMIŞ bir
 * `attempt` ile gelmelidir. Kural tek cümle: **`attempt` her zaman satırın
 * `analysis_attempt` kolonunun o anki değeridir**, ve yeniden ekleyen taraf
 * kolonu önce artırır (`requeueStuckQuoteParts` böyle yapar). İlk ekleme
 * (parça yeni eklendi, kolon 0) bu yüzden `0` ile gelir; süpürmenin ürettiği
 * kimlikler 1, 2, … diye artar ve hiçbiri tekrar etmez.
 *
 * `priority` yalnız kurtarma için verilir: taze müşteri yüklemesi, saatlerdir
 * bekleyen bir artığın arkasında kuyruğa girmemeli (büyük sayı = düşük öncelik).
 */
export async function enqueuePartAnalysis(
  partId: string,
  attempt: number,
  priority?: number
): Promise<void> {
  await getQuoteAnalysisQueue().add(
    "analyze",
    { partId },
    {
      jobId: `quote-part-analysis-${partId}-r${attempt}`,
      ...(priority === undefined ? {} : { priority }),
    }
  );
}

export async function enqueueQuoteOrderFiles(orderId: string, quoteId: string): Promise<void> {
  await getQuoteOrderFilesQueue().add(
    "bake",
    { orderId, quoteId },
    { jobId: `quote-order-files-${orderId}` }
  );
}
