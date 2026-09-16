import { Worker, Job } from "bullmq";
import { lt } from "drizzle-orm";
import { getRedisConnection } from "../connection";
import { db } from "../../db";
import { manufacturerAssignmentEvaluations } from "../../db/schema";
import { purgeOldPainterEvaluations } from "../../services/painter-evaluation";

/**
 * Q7 retention cleanup. Manufacturer scoring evaluation rows are written on
 * every assignment + N12 retry. After cutover the table is only useful for
 * recent diagnostics — we keep 30 days and drop older rows so the table
 * doesn't grow unbounded.
 *
 * Mirrors the preview-cleanup worker pattern (hourly schedule, console
 * logging via job.log).
 *
 * BOYACI KARAR KAYITLARI DA BURADA SÜPÜRÜLÜR (Faz 4). İkinci bir worker
 * açılmadı: iki tablo da aynı sebeple (her atamada, her yeniden yerleştirmede)
 * büyüyor ve aynı tanı penceresine hizmet ediyor. Ayrı zamanlayıcı, birinin
 * sessizce durması hâlinde tek tablonun şişmesi demekti — oysa aynı işi yapan
 * iki temizlik tek yerde durduğunda "temizlik koşuyor mu" sorusunun tek bir
 * cevabı olur. Pencerenin KENDİSİ tablonun kendi modülünde kalır
 * (services/painter-evaluation.ts): iki saklama süresi ileride ayrışabilir ve
 * burada tek bir sabite bağlamak, birini değiştirenin öbürünü sessizce
 * kısaltmasına yol açardı.
 */
const RETENTION_DAYS = 30;

async function processJob(job: Job) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

  const result = await db
    .delete(manufacturerAssignmentEvaluations)
    .where(lt(manufacturerAssignmentEvaluations.createdAt, cutoff))
    .returning({ id: manufacturerAssignmentEvaluations.id });

  // Hata YUTULMAZ: iki silme de kesim tarihine göre çalıştığı için yeniden
  // denenmesi zararsızdır (aynı satırlar zaten gitmiştir), o yüzden hatayı
  // BullMQ'nun görüp işi tekrar denemesi doğru davranış. Yutulsaydı tablo
  // sessizce büyür ve bunu kimse fark etmezdi — bu worker'ın var olma sebebi
  // tam olarak o sessizliği önlemek.
  const painterDeleted = await purgeOldPainterEvaluations();

  job.log(
    `Deleted ${result.length} manufacturer + ${painterDeleted} painter scoring ` +
      `evaluations older than ${RETENTION_DAYS}d`
  );
}

export function startScoringEvaluationsCleanupWorker() {
  const worker = new Worker("scoring-evaluations-cleanup", processJob, {
    connection: getRedisConnection(),
    concurrency: 1,
  });

  worker.on("completed", (job) => {
    console.info(`scoring-evaluations-cleanup completed: ${job.id}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`scoring-evaluations-cleanup failed:`, error.message);
  });

  return worker;
}
