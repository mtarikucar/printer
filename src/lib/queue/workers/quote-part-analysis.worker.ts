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

/**
 * `queued` bu süreyi aşarsa takılmış sayılır (`analyzing` iki katında).
 *
 * ÖLÇÜ, CONCURRENCY 1'DEKİ EN KÖTÜ MEŞRU BEKLEME SÜRESİDİR. Tek bir parça bu
 * worker'ı en çok ~10 dakika meşgul edebilir: python'un sert tavanı 5 dakika
 * (`mesh-runner` ANALYZE_TIMEOUT_MS, sonra SIGKILL) ve kuyruk varsayılanı işi
 * bir kez daha deniyor (`quote-queues` `attempts: 2`). Bir müşterinin tek
 * yüklemesi en çok `maxPartsPerQuote` (tohum: 20) parça açabildiği için, o
 * yüklemenin SON parçası önündeki 19 parçayı beklerken 3 saati aşabilir —
 * hepsi meşrudur, hiçbiri takılmış değildir.
 *
 * Eşik bu yüzden İKİ yönlü seçildi: tek bir uzun analizi "takılmış" saymayacak
 * kadar büyük (10 dakikanın 3 katı; eski 10 dakikalık değer, sırada bekleyen
 * her parçayı meşgul bir kuyrukta boşuna yeniden kuyruğa alıyordu), ama
 * Redis'in gerçekten düşürdüğü bir işi müşteri sayfayı kapatmadan kurtaracak
 * kadar küçük. Meşru uzun kuyruğu vazgeçmeden korumak eşiğin değil TAVANIN işi:
 * vazgeçme ufku ≈ `MAX_ANALYSIS_ATTEMPTS` × bu değer = 5 saat > 3,2 saat.
 */
export const STUCK_QUEUED_MS = 30 * 60_000;

async function runJob(job: Job<QuotePartAnalysisJob>) {
  if (job.name === "recover") {
    const { requeued, gaveUp } = await requeueStuckQuoteParts(STUCK_QUEUED_MS);
    if (requeued > 0) job.log(`${requeued} takılan parça yeniden kuyruğa alındı`);
    // Vazgeçme operatörün görmesi gereken tek olaydır: müşteri o parça için
    // "dosya okunamadı" görecek ve fiyatı manuel girilmediyse teklif kapanmaz.
    if (gaveUp > 0) job.log(`${gaveUp} parça deneme tavanını aştı, failed yazıldı`);
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
