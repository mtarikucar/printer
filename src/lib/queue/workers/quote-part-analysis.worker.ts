/**
 * Teklif parçası analiz worker'ı.
 *
 * İki iş adı taşır: `analyze` tek bir parçayı ölçer, `recover` (5 dakikalık
 * zamanlayıcı) Redis'in unuttuğu parçaları geri kuyruğa alır. Kurtarma aynı
 * worker'da durur çünkü aynı kuyruğun sağlığını onarıyor; ayrı bir worker
 * yalnız ikinci bir kapatma yolu olurdu.
 *
 * İşin kendisi `quote-analysis.ts` içindedir: burada yalnız eşzamanlılık,
 * kilit süresi ve kayıt vardır.
 */
import { Worker, Job } from "bullmq";
import { getRedisConnection } from "../connection";
import { QUOTE_ANALYSIS_QUEUE, type QuotePartAnalysisJob } from "../quote-queues";
import { analyzeQuotePart, requeueStuckQuoteParts } from "../../services/quote-analysis";

/** `queued` bu süreyi aşarsa takılmış sayılır (`analyzing` iki katında). */
export const STUCK_QUEUED_MS = 10 * 60_000;

async function runJob(job: Job<QuotePartAnalysisJob>) {
  if (job.name === "recover") {
    const recovered = await requeueStuckQuoteParts(STUCK_QUEUED_MS);
    if (recovered > 0) job.log(`${recovered} takılan parça yeniden kuyruğa alındı`);
    return;
  }
  const outcome = await analyzeQuotePart(job.data.partId, { onLog: (line) => job.log(line) });
  job.log(`parça ${job.data.partId}: ${outcome}`);
}

export function startQuotePartAnalysisWorker(): Worker {
  const worker = new Worker<QuotePartAnalysisJob>(QUOTE_ANALYSIS_QUEUE, runJob, {
    connection: getRedisConnection(),
    // python tek çekirdeği doyuruyor ve bu kutuda mesh-processing ile aynı CPU'yu
    // paylaşıyor; ikisini birden koşturmak Node'un olay döngüsünü aç bırakır ve
    // BullMQ iş kilidini yenileyemez.
    concurrency: 1,
    // Kilidi worker periyodik olarak yeniler; yenileyemediği tek durum olay
    // döngüsünün python'un altında aç kalmasıdır. 30 sn'lik varsayılan bunu
    // atlatamaz: iş "stalled" sayılır ve İKİNCİ kez çalışır.
    lockDuration: 300_000,
    maxStalledCount: 1,
  });

  worker.on("failed", (job, err) => {
    console.error(`[quote-part-analysis] job ${job?.id} failed: ${err.message}`);
  });
  return worker;
}
