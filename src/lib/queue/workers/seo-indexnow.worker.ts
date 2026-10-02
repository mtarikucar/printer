/**
 * Statik sayfaların IndexNow duyurusunu koşan işçi.
 *
 * TETİKLEYİCİ NEDEN BİR ZAMANLAYICI. Duyurulması gereken olay bir DAĞITIMDIR:
 * "son güncelleme" tarihi değişen bir sayfa yayına girdi. Zamanlayıcı saatte bir
 * koşuyor (kayıt `workers/start.ts`te, zamanlamanın ölçümü de oradaki yorumda),
 * yani değişen sayfa dağıtımdan en çok bir saat sonra duyurulur. Saatlik tekrar
 * aynı zamanda bir AĞ'dır: ağ hatasıyla kaçan bir duyuru bir sonraki turda
 * yakalanır, çünkü hafıza yalnız başarılı gönderimden sonra yazılıyor.
 *
 * Tur, tarihi değişmeyen sayfaya DOKUNMAZ (`announceStaticPages` kararı), yani
 * fazla tetik bedavadır: değişen yoksa ağa hiç çıkılmaz.
 *
 * NOT: `import "server-only"` YOK ve zincirine de sızmıyor — bu dosya
 * standalone Node worker sürecinde yükleniyor ([[worker-server-only-trap]]).
 */
import { Job, Worker } from "bullmq";
import {
  announceStaticPages,
  type AnnounceOptions,
} from "../../services/indexnow-pages";
import { getRedisConnection } from "../connection";
import { SEO_INDEXNOW_QUEUE } from "../seo-queues";

/**
 * Turun GÖVDESİ. İhraç edilmesinin sebebi `fx-refresh.worker.ts` ile aynı:
 * davranış kaynak taramasıyla değil GERÇEK bir koşumla sınanabilsin.
 *
 * Parametre `Pick<Job, "log">`: gövdenin işten kullandığı tek şey günlük satırı.
 */
export async function runSeoIndexNowJob(
  job: Pick<Job, "log">,
  options: AnnounceOptions = {}
) {
  // `scope` SABİT: otomatik tur yalnız DEĞİŞENLERİ gönderir ve bu bir karar,
  // bir varsayılan değil. `options` yalnız hafızayı/host'u enjekte etmek için
  // var (test gerçek bir koşumla sınıyor); kapsam geçilse bile ezilmez.
  const outcome = await announceStaticPages({ ...options, scope: "changed" });

  if (outcome.ok) {
    if (outcome.kind === "baseline") {
      await job.log("hafıza boştu — bugünkü tarihler temel alındı, gönderim YOK");
    } else if (outcome.kind === "no_change") {
      await job.log("değişen sayfa yok — ağa çıkılmadı");
    } else {
      await job.log(
        `${outcome.submitted} sayfa duyuruldu: ${outcome.paths.map((p) => p || "/").join(", ")}`
      );
    }
    return;
  }

  if (outcome.reason === "no_key" || outcome.reason === "no_store") {
    // YAPILANDIRMA DURUMU, ARIZA DEĞİL: yeniden denemek düzeltmez ve her turda
    // bir `failed` satırı yazmak gerçek hataları görünmez kılardı. Operatör
    // yüzeyi (`/admin/ayarlar`) bu iki durumu açıkça gösteriyor.
    await job.log(`tur atlandı (${outcome.reason}) — gönderim yapılmadı`);
    return;
  }

  // FIRLATMAK BİLEREK: `announceStaticPages` hiç atmaz (etiketli sonuç döner),
  // ama bullmq'nun yeniden denemesi yalnız ATAN bir işte devreye girer ve
  // başarısız tur ancak böyle `failed` listesinde iz bırakır. Hafıza
  // yazılmadığı için bir sonraki tur aynı farkı yeniden gönderir.
  throw new Error(`IndexNow duyurusu başarısız: ${outcome.reason}`);
}

export function startSeoIndexNowWorker(): Worker {
  // Gövde LAMBDA ile sarılı: bullmq işçiye ikinci argüman olarak kilit
  // belirtecini (`token: string`) geçiyor ve gövdenin ikinci parametresi
  // (`options`) onunla çakışırdı. Sarmalayıcı belirteci yutuyor, yani işçi
  // gövdeyi her zaman varsayılan (Redis) hafızasıyla koşturur.
  const worker = new Worker(SEO_INDEXNOW_QUEUE, (job) => runSeoIndexNowJob(job), {
    connection: getRedisConnection(),
    concurrency: 1,
  });

  worker.on("failed", (job, err) => {
    console.error(`[seo-indexnow] job ${job?.id} failed: ${err.message}`);
  });
  return worker;
}
