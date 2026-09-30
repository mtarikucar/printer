/**
 * TCMB kur bülteninin çekme işçisi.
 *
 * AYRI WORKER — bakım işine (`quote-maintenance`) sokulmadı. Gerekçe somut: o
 * işçi `concurrency: 1` + `lockDuration: 600_000` ile koşuyor, çünkü tek turu
 * sınırına kadar dolduğunda 400 mektup gönderip 200 parçanın dosyalarını
 * siliyor (bugün yedi aşama taşıyor). 600 saniyelik bir kilit AĞ İÇİN değil,
 * o süpürme için var; oraya bir HTTP çağrısı sokmak hem o kilidi hem o işin
 * anlamını kirletirdi.
 *
 * `lockDuration` VARSAYILAN (30 sn) bırakıldı ve bu bilinçli: tur bir HTTP
 * çağrısı (`TCMB_TIMEOUT_MS = 8 sn`) ve üç satırlık tek bir upsert'ten oluşur,
 * yani varsayılana fazlasıyla sığar. Gereksiz büyütülen bir kilit, gerçekten
 * takılan bir turun fark edilmesini geciktirir.
 *
 * `concurrency: 1`: turun tek yazımı `ON CONFLICT DO NOTHING`, yani ikinci bir
 * kopya veri bozmaz — ama aynı bülteni iki kez indirmenin de bir faydası yok.
 *
 * NOT: `import "server-only"` YOK ve zincirine de sızmaz (`fx-rates.ts`
 * başlığı): bu dosya standalone Node worker sürecinde yükleniyor.
 */
import { Job, Worker } from "bullmq";
import { refreshFxRates } from "../../services/fx-rates";
import { isFlagEnabled } from "../../services/flags";
import { getRedisConnection } from "../connection";
import { FX_REFRESH_QUEUE } from "../quote-queues";

async function runJob(job: Job) {
  // Bayrak okuması turun İLK işi: özellik kapalıyken TCMB'ye hiç çıkılmaz.
  // Kapatma bir DB satırıdır, dağıtım gerektirmez — bu satır o kapatmanın
  // worker tarafındaki karşılığıdır.
  if (!(await isFlagEnabled("quote_fx_display_enabled"))) {
    await job.log("quote_fx_display_enabled KAPALI — tur atlandı, TCMB'ye çıkılmadı");
    return;
  }

  const outcome = await refreshFxRates();
  if (!outcome.ok) {
    await job.log(`tur başarısız (${outcome.reason}) — son geçerli kur yerinde kaldı`);
    // FIRLATMAK BURADA BİLEREK: `fx-rates.ts` hiç atmaz (etiketli sonuç döner),
    // ama BullMQ'nun yeniden denemesi (`DEFAULT_JOB_OPTIONS.attempts = 2`)
    // yalnız ATAN bir işte devreye girer ve başarısız tur ancak böyle `failed`
    // listesinde iz bırakır. İki deneme de düşerse satır yazılmaz ve son
    // geçerli kur durur (fail-closed).
    throw new Error(`TCMB kur turu başarısız: ${outcome.reason}`);
  }
  await job.log(
    `TCMB bülteni ${outcome.bulletinDate} · yazılan satır: ${outcome.insertedRows}` +
      (outcome.insertedRows === 0 ? " (aynı bülten zaten yazılmıştı)" : "")
  );
}

export function startFxRefreshWorker(): Worker {
  const worker = new Worker(FX_REFRESH_QUEUE, runJob, {
    connection: getRedisConnection(),
    concurrency: 1,
  });

  worker.on("failed", (job, err) => {
    console.error(`[fx-refresh] job ${job?.id} failed: ${err.message}`);
  });
  return worker;
}
