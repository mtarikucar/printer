/**
 * Ödenen teklifin parça dosyalarını siparişe pişiren worker.
 *
 * İki iş adı taşır: `bake` tek bir siparişin dosyalarını bağlar, `recover`
 * (5 dakikalık zamanlayıcı) dosyaları HİÇ eklenmemiş teklif siparişlerini
 * (`quotes.files_attached_at IS NULL`) tarayıp aynı işi yapar. Ölçü DAMGADIR,
 * "dosya satırı yok" DEĞİL: admin bir revizyonu silerken dosya satırlarını ve
 * sürüm başlığını birlikte kaldırıyor, o yüzden eski ölçü adminin bilerek
 * sildiği müşteri dosyalarını geri getiriyordu.
 *
 * KURTARMA NEDEN YENİDEN KUYRUĞA ALMAZ: `bake` işinin kimliği sipariş başına
 * tekildir (`quote-order-files-<orderId>`) ve bullmq, SAKLANAN (tamamlanmış ya
 * da başarısız) bir işin kimliğiyle gelen ikinci eklemeyi hata vermeden YUTAR.
 * Kurtarma aynı kimlikle ekleseydi hiçbir şey çalışmaz, her denemede yeni bir
 * kimlik üretseydi de aynı sipariş için paralel iki pişirme doğabilirdi. İş
 * doğrudan burada, sırayla yapılır — `attachQuoteFilesToOrder` zaten tekrar
 * çalıştırılabilir.
 *
 * İşin kendisi `quote-order.ts` içindedir: burada yalnız eşzamanlılık, kilit
 * süresi ve kayıt vardır.
 */
import { Worker, Job } from "bullmq";
import { getRedisConnection } from "../connection";
import { QUOTE_ORDER_FILES_QUEUE, type QuoteOrderFilesJob } from "../quote-queues";
import {
  attachQuoteFilesToOrder,
  findQuoteOrdersMissingFiles,
} from "../../services/quote-order";

/** Tek süpürmede en fazla kaç sipariş onarılır (kuyruğu aç bırakmamak için). */
export const RECOVERY_BATCH = 20;

async function runJob(job: Job<QuoteOrderFilesJob>) {
  if (job.name === "recover") {
    const pending = await findQuoteOrdersMissingFiles(RECOVERY_BATCH);
    for (const row of pending) {
      try {
        const outcome = await attachQuoteFilesToOrder(row.orderId);
        job.log(`kurtarma · sipariş ${row.orderId}: ${outcome}`);
      } catch (err) {
        // Bir siparişin hatası kalan siparişleri düşürmemeli: süpürme ertesi
        // turda aynı satırı yeniden dener.
        console.error(`[quote-order-files] kurtarma ${row.orderId} başarısız`, err);
      }
    }
    if (pending.length > 0) job.log(`${pending.length} dosyasız teklif siparişi tarandı`);
    return;
  }
  const outcome = await attachQuoteFilesToOrder(job.data.orderId);
  job.log(`sipariş ${job.data.orderId}: ${outcome}`);
}

export function startQuoteOrderFilesWorker(): Worker {
  const worker = new Worker<QuoteOrderFilesJob>(QUOTE_ORDER_FILES_QUEUE, runJob, {
    connection: getRedisConnection(),
    // İş disk kopyalama/akıştan ibaret (CPU'yu doyurmaz), ama tek bir müşterinin
    // yirmi parçası ardındaki siparişi bekletmesin diye iki tane koşar.
    concurrency: 2,
    // Yüz megabaytlık bir mesh'i ölçeklemek 30 sn'lik varsayılanı aşabilir.
    // Akış olduğu için olay döngüsü boştur ve kilit yenilenir; yine de pay bırak.
    lockDuration: 120_000,
  });

  worker.on("failed", (job, err) => {
    console.error(`[quote-order-files] job ${job?.id} failed: ${err.message}`);
  });
  return worker;
}
