/**
 * Anlık teklifin saatlik bakım işçisi: sahipsiz hediye kartı rezervasyonları,
 * süre dolumu, iki hatırlatma, saklama süpürmesi, yetim dizin süpürmesi.
 *
 * Tek iş adı (`tick`) taşır ve işin kendisi `quote-maintenance.ts`
 * içindedir — burada yalnız eşzamanlılık, kilit süresi ve kayıt vardır.
 *
 * EŞZAMANLILIK 1: turun bütün yazımları koşullu, yani ikinci bir kopya para ya
 * da mektup kaybettirmez; ama aynı depolama anahtarını paylaşan iki parçayı
 * aynı anda süpürürse her kopya ÖTEKİNİN parçasını "hâlâ gösteriyor" sayar ve
 * dosya sahipsiz biçimde diskte kalırdı (veri kaybı değil, artık). Tek kopya
 * bu hâli tümden ortadan kaldırıyor; tur saatte bir koştuğu için bedeli yok.
 */
import { Worker, Job } from "bullmq";
import { getRedisConnection } from "../connection";
import { QUOTE_MAINTENANCE_QUEUE } from "../quote-queues";
import { runQuoteMaintenance } from "../../services/quote-maintenance";

async function runJob(job: Job) {
  const outcome = await runQuoteMaintenance(new Date());
  job.log(
    `sahipsiz rezervasyon: ${outcome.promotedGiftDrafts} · süresi dolan: ${outcome.expired} · ` +
      `süre hatırlatması: ${outcome.expiryReminders} · ` +
      `terk hatırlatması: ${outcome.abandonedReminders} · süpürülen parça: ${outcome.purgedParts} · ` +
      `yetim dizin: ${outcome.orphanDirs}`
  );
}

export function startQuoteMaintenanceWorker(): Worker {
  const worker = new Worker(QUOTE_MAINTENANCE_QUEUE, runJob, {
    connection: getRedisConnection(),
    concurrency: 1,
    // Tur, sınırına kadar dolduğunda 400 mektup gönderip 200 parçanın
    // dosyalarını siler; 30 sn'lik varsayılan kilit bunu taşımaz ve iş
    // "stalled" sayılıp İKİNCİ kez çalışırdı.
    lockDuration: 600_000,
  });

  worker.on("failed", (job, err) => {
    console.error(`[quote-maintenance] job ${job?.id} failed: ${err.message}`);
  });
  return worker;
}
