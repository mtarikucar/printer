import { Worker, Job } from "bullmq";
import { and, lt, inArray, notInArray, sql } from "drizzle-orm";
import { getRedisConnection } from "../connection";
import { db } from "../../db";
import { previews, orders } from "../../db/schema";
import { deleteFile } from "../../services/storage";
import { sweepStagedUploads } from "../../services/chunked-upload";
import {
  sweepExpiredPhotoFiles,
  storageKeyReferencedBy,
} from "../../services/photo-file-retention";

const BATCH_SIZE = 50;
const EXPIRY_DAYS = 30;

async function processJob(job: Job) {
  // Staged chunks from uploads nobody finished (browser closed mid-upload) —
  // a 350 MB model left behind would otherwise sit on disk forever.
  const staleChunks = await sweepStagedUploads().catch(() => 0);
  if (staleChunks > 0) job.log(`Swept ${staleChunks} abandoned upload chunks`);

  // Admin'in kaldırdığı referans fotoğraflarının bekleme süresi dolanları.
  // Süpürme daha önce YALNIZCA fotoğraf ekleme/kaldırma ucuna trafik geldiğinde
  // koşuyordu: admin bir daha o ekrana dokunmazsa "7 gün sonra silinecek" denen
  // müşteri yüzü süresiz diskte kalıyordu. Saatlik iş, o takvimi işletir.
  const photoFiles = await sweepExpiredPhotoFiles().catch((e) => {
    console.error("preview-cleanup: photo file sweep failed", e);
    return null;
  });
  if (photoFiles && (photoFiles.deleted > 0 || photoFiles.kept > 0)) {
    job.log(
      `Photo file sweep: ${photoFiles.deleted} deleted, ${photoFiles.kept} kept (still referenced)`
    );
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - EXPIRY_DAYS);

  // Find preview IDs that have an order (should not be deleted)
  const orderedPreviewIds = db
    .select({ previewId: orders.previewId })
    .from(orders)
    .where(sql`${orders.previewId} IS NOT NULL`);

  const expiredPreviews = await db.query.previews.findMany({
    where: and(
      lt(previews.createdAt, cutoff),
      inArray(previews.status, ["ready", "failed", "expired"]),
      notInArray(previews.id, orderedPreviewIds)
    ),
    columns: {
      id: true,
      glbKey: true,
      photoKey: true,
      photoKeys: true,
    },
    limit: BATCH_SIZE,
  });

  if (expiredPreviews.length === 0) {
    job.log("No expired previews to clean up");
    return;
  }

  let deleted = 0;
  let filesDeleted = 0;
  let filesKept = 0;
  for (const preview of expiredPreviews) {
    try {
      // Delete every uploaded reference photo. photoKeys (when present) already
      // includes the primary photoKey as its first element, so prefer it;
      // otherwise fall back to the single photoKey.
      const photoKeysToDelete =
        preview.photoKeys && preview.photoKeys.length > 0
          ? preview.photoKeys
          : preview.photoKey
            ? [preview.photoKey]
            : [];
      const keys = [...new Set([preview.glbKey, ...photoKeysToDelete])].filter(
        (k): k is string => !!k
      );

      for (const key of keys) {
        // SİLMEDEN ÖNCE REFERANS SAYIMI. Bu satırın anahtarı yalnız bu
        // önizlemeye ait değil: yeniden sipariş (reorder) orijinal siparişin
        // anahtarını yeni taslağa taşır ve taslak siparişe dönüşünce aynı
        // anahtarla order_photos satırı açılır; aynı fotoğraftan ikinci bir
        // önizleme de üretilebilir (preview/[id]/regenerate). Sayım olmadan
        // süresi dolan bir önizlemeyi temizlemek, CANLI bir siparişin
        // gösterdiği dosyayı siliyordu.
        //
        // Kontrol okunamazsa dosya KORUNUR: silme geri alınamaz, oysa dosya
        // sonraki turda yeniden değerlendirilebilir — ama satır zaten
        // gittiyse değerlendirilemez, bu yüzden hata durumunda satırı da
        // silmeyip bir sonraki tura bırakıyoruz (aşağıdaki throw).
        const referencedBy = await storageKeyReferencedBy(key, {
          countPreviews: true,
          // Silinmekte olan önizlemenin KENDİ satırı referans sayılmaz; yoksa
          // hiçbir dosya hiçbir zaman silinemezdi.
          ignorePreviewId: preview.id,
        });
        if (referencedBy) {
          job.log(`Kept ${key}: still referenced by ${referencedBy}`);
          filesKept++;
          continue;
        }
        await deleteFile(key);
        filesDeleted++;
      }

      await db.delete(previews).where(sql`${previews.id} = ${preview.id}`);
      deleted++;
    } catch (error) {
      job.log(`Failed to clean preview ${preview.id}: ${error}`);
    }
  }

  job.log(
    `Cleaned up ${deleted}/${expiredPreviews.length} expired previews ` +
      `(${filesDeleted} files deleted, ${filesKept} kept — still referenced)`
  );
}

export function startPreviewCleanupWorker() {
  const worker = new Worker("preview-cleanup", processJob, {
    connection: getRedisConnection(),
    concurrency: 1,
  });

  worker.on("completed", (job) => {
    console.info(`Preview cleanup completed: ${job.id}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`Preview cleanup failed:`, error.message);
  });

  return worker;
}
