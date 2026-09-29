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
 * `queued` bu süreyi aşarsa süpürme işi YENİDEN EKLER (`analyzing` iki katında).
 *
 * EŞİK BİR CEZA DEĞİL, BİR TAHMİNDİR: "bu işi Redis düşürmüş olabilir". Yanlış
 * tahminin bedeli ucuzdur — parça gerçekten sırada bekliyorsa eklenen kopya iş
 * onu `queued` bulamaz ve `"skipped"` döner. Sırada bekleyen parçadan ASLA
 * vazgeçilmez (`requeueStuckQuoteParts`, 1. dal), yani eşik kuyruğun KÜRESEL
 * uzunluğuyla ilgili hiçbir varsayım yapmak zorunda değildir: iki müşteri aynı
 * anda yirmişer parça yüklese ya da bir kesinti sonrası yüzlerce parça birikse
 * de sonuç yalnız "bir tur fazladan kopya iş"tir, veri kaybı değil.
 *
 * Değer bu yüzden tek bir ölçüye göre seçilir: ÇALIŞAN MEŞRU BİR İŞİN ÜSTÜNE
 * KOPYA EKLEMEMEK. Tek bir parça bu worker'ı en çok ~10 dakika meşgul edebilir —
 * python'un sert tavanı 5 dakika (`mesh-runner` ANALYZE_TIMEOUT_MS, sonra
 * SIGKILL) × kuyruğun `attempts: 2` varsayılanı (`quote-queues`). 30 dakika
 * bunun üç katıdır. Eski 10 dakikalık değer bu tek ölçüyü bile karşılamıyordu:
 * meşgul bir kuyrukta sıradaki HER parçaya her turda bir kopya iş üretiyordu.
 * Üst sınırı ise "kaybolan işi müşteri sayfayı kapatmadan kurtar" koyar; kabul
 * edilen takas, gerçekten düşmüş bir işin kurtarılmasının ≤15 dk yerine ≤35 dk
 * sürmesidir.
 *
 * `analyzing` için tanınan süre bunun İKİ katıdır (`ANALYZING_GRACE_FACTOR`,
 * 60 dk) ve VAZGEÇMENİN kapısı odur: meşru bir analiz 5 dakikayı aşamadığı için
 * 60 dakikadır `analyzing` görünen satır, altında ölmüş bir iştir. Vazgeçme ufku
 * (`MAX_ANALYSIS_ATTEMPTS` × bu pencere ≈ 6 saat) böylece yalnız ÇÖKME turlarını
 * sayar, kuyrukta geçen süreyi değil.
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
