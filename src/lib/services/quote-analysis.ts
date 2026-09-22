/**
 * Teklif parçasının geometri analizi: kaynak dosya → ölçüm + üç çıktı dosyası.
 *
 * Müşteri bu işin bitmesini bekliyor (fiyat ondan çıkıyor), ama parçayı aynı
 * anda silebilir, birimini değiştirebilir ya da teklifi terk edebilir. Bu
 * yüzden HER YAZIM KOŞULLUDUR: iş yalnız kendi bıraktığı durumun üzerine yazar
 * (`analysis_status = 'analyzing' AND deleted_at IS NULL`). Yarışı kaybeden
 * kopya hiçbir şeye dokunmaz.
 *
 * NOT: `import "server-only"` YOK — BullMQ worker süreci bu modülü yükler.
 */
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { mkdtemp, copyFile, readFile, rm, access } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { db } from "@/lib/db";
import { quoteParts, quotes } from "@/lib/db/schema";
import type { AnalysisStatus, PartGeometry, QuoteUnits } from "@/lib/config/quote-types";
import { MeshProcessError, runAnalyzeQuotePart } from "@/lib/services/mesh-runner";
import {
  absoluteFilePath,
  deleteFile,
  saveFile,
  saveFileFromPath,
} from "@/lib/services/storage";
import { recomputeQuoteCache } from "@/lib/services/quote-cache";
import { emitQuotePartChanged } from "@/lib/realtime/emit";
import { enqueuePartAnalysis } from "@/lib/queue/quote-queues";

/** Küçük resim WebP kalitesi: 512²'lik izometrik still için gözle aynı, ~4× küçük. */
const THUMBNAIL_QUALITY = 82;
/**
 * Kurtarma süpürmesinde `analyzing` için tanınan süre, `queued` süresinin iki
 * katıdır: sırada bekleyen iş hiç başlamamıştır, çalışan iş python'un altında
 * olabilir ve onu boşuna iki kez çalıştırmak tek çekirdeği israf eder.
 */
const ANALYZING_GRACE_FACTOR = 2;

/** Kurtarma yeniden kuyruğa alırken taze müşteri yüklemesinin arkasına geçer. */
const RECOVERY_PRIORITY = 10;

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

interface StoredOutputs {
  canonicalStlKey: string;
  previewGlbKey: string | null;
  thumbnailKey: string | null;
}

/**
 * Python'un geçici dizine bıraktığı çıktıları kalıcı anahtarlara taşır.
 *
 * Kanonik STL ZORUNLUDUR (üretici onu basar). Önizleme GLB'si ve küçük resim
 * KOZMETİKTİR: python onları yazamazsa (ya da sharp PNG'yi çeviremezse) ölçüm
 * yine geçerlidir ve müşteri fiyatını alır — resimsiz bir satır, fiyatsız bir
 * tekliften iyidir.
 *
 * Depolama hatası buna dahil DEĞİLDİR ve bilerek yukarı fırlar: kanonik kopya
 * hemen yukarıda başarılı olmuştur, yani disk yazılabilir; ondan sonra gelen
 * bir yazım hatası gerçek bir arızadır ve `failed` olarak görünmelidir.
 */
async function storeOutputs(
  partId: string,
  work: string,
  onLog?: (line: string) => void
): Promise<StoredOutputs> {
  const subdir = `quote-parts/${partId}`;
  const canonicalStlKey = await saveFileFromPath(
    join(work, "canonical.stl"),
    subdir,
    `canonical-${nanoid(8)}.stl`
  );

  let previewGlbKey: string | null = null;
  const glbPath = join(work, "preview.glb");
  if (await exists(glbPath)) {
    previewGlbKey = await saveFileFromPath(glbPath, subdir, `preview-${nanoid(8)}.glb`);
  } else {
    onLog?.("preview.glb yok — önizleme atlandı");
  }

  let thumbnailKey: string | null = null;
  const pngPath = join(work, "thumb.png");
  if (await exists(pngPath)) {
    try {
      const webp = await sharp(await readFile(pngPath)).webp({ quality: THUMBNAIL_QUALITY }).toBuffer();
      thumbnailKey = await saveFile(Buffer.from(webp), subdir, `thumb-${nanoid(8)}.webp`);
    } catch (err) {
      onLog?.(`küçük resim atlandı: ${(err as Error).message}`);
    }
  } else {
    onLog?.("thumb.png yok — küçük resim atlandı");
  }

  return { canonicalStlKey, previewGlbKey, thumbnailKey };
}

/**
 * Sahibi kalmayan çıktıları siler.
 *
 * Analiz biterken parça silinmiş ya da sıfırlanmışsa koşullu güncelleme sıfır
 * satır etkiler; o anahtarları hiçbir satır göstermez ve diskte öksüz kalırlar.
 */
async function discardOutputs(stored: StoredOutputs): Promise<void> {
  const keys = [stored.canonicalStlKey, stored.previewGlbKey, stored.thumbnailKey];
  for (const key of keys) {
    if (key) await deleteFile(key).catch(() => {});
  }
}

/**
 * Analiz bittiğinde birimi YALNIZ dosya söylüyorsa ve müşteri henüz
 * dokunmadıysa düzeltir.
 *
 * 3MF kendi birimini beyan eder; STL/OBJ etmez (`sourceUnits = null`). Koşul
 * güncellemenin İÇİNDE, `CASE` ile kurulur: müşteri analiz sürerken birimi
 * elle değiştirmiş olabilir ve iş onun seçimini ezmemelidir.
 */
function unitsPatch(geometry: PartGeometry) {
  if (!geometry.sourceUnits) return {};
  return {
    units: sql<QuoteUnits>`CASE WHEN ${quoteParts.units} = 'mm' THEN ${geometry.sourceUnits} ELSE ${quoteParts.units} END`,
  };
}

/**
 * Tek bir parçayı analiz eder.
 *
 * - `"skipped"`: parça `queued` değil ya da silinmiş — yapılacak iş yok.
 * - `"ready"` / `"failed"`: parçanın yeni durumu; her ikisi de NİHAİDİR.
 *
 * Başarısızlık FIRLATMAZ: python'un reddettiği bir dosya yeniden denemekle
 * geçerli olmaz, ve `failed` müşteriye gösterilecek gerçek bir durumdur.
 * Fırlatan tek şey altyapıdır (DB/Redis erişilemez) — onu worker'ın deneme
 * politikası toplasın.
 */
export async function analyzeQuotePart(
  partId: string,
  opts: { onLog?: (line: string) => void } = {}
): Promise<"ready" | "failed" | "skipped"> {
  const onLog = opts.onLog;
  const [part] = await db
    .update(quoteParts)
    .set({
      analysisStatus: "analyzing",
      analysisAttempt: sql`${quoteParts.analysisAttempt} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(quoteParts.id, partId),
        eq(quoteParts.analysisStatus, "queued"),
        isNull(quoteParts.deletedAt)
      )
    )
    .returning();
  if (!part) return "skipped";

  const [quote] = await db
    .select({ userId: quotes.userId })
    .from(quotes)
    .where(eq(quotes.id, part.quoteId))
    .limit(1);
  const announce = (status: AnalysisStatus) =>
    emitQuotePartChanged({
      quoteId: part.quoteId,
      partId,
      status,
      userId: quote?.userId ?? null,
    });
  announce("analyzing");

  const work = await mkdtemp(join(tmpdir(), "quote-part-"));
  try {
    // Kaynağı KOPYALAYARAK çalış: python'un çalışma dizini yüklenen dosyanın
    // yanında olmasın, ve uzantı her zaman biçimle uyuşsun.
    const inputPath = join(work, `source.${part.sourceFormat}`);
    await copyFile(absoluteFilePath(part.sourceKey), inputPath);

    const { geometry } = await runAnalyzeQuotePart({
      inputPath,
      format: part.sourceFormat,
      outDir: work,
      onLog,
    });
    const stored = await storeOutputs(partId, work, onLog);

    const [ready] = await db
      .update(quoteParts)
      .set({
        analysisStatus: "ready",
        analysisError: null,
        geometry,
        canonicalStlKey: stored.canonicalStlKey,
        previewGlbKey: stored.previewGlbKey,
        thumbnailKey: stored.thumbnailKey,
        ...unitsPatch(geometry),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(quoteParts.id, partId),
          eq(quoteParts.analysisStatus, "analyzing"),
          isNull(quoteParts.deletedAt)
        )
      )
      .returning({ id: quoteParts.id });

    if (!ready) {
      onLog?.("parça analiz sırasında silindi ya da sıfırlandı — sonuç atıldı");
      await discardOutputs(stored);
      return "skipped";
    }

    await recomputeQuoteCache(part.quoteId);
    announce("ready");
    return "ready";
  } catch (err) {
    const code = err instanceof MeshProcessError ? err.code : "unknown";
    onLog?.(`analiz başarısız (${code}): ${(err as Error).message}`);
    const [failed] = await db
      .update(quoteParts)
      .set({ analysisStatus: "failed", analysisError: code, updatedAt: new Date() })
      .where(
        and(
          eq(quoteParts.id, partId),
          eq(quoteParts.analysisStatus, "analyzing"),
          isNull(quoteParts.deletedAt)
        )
      )
      .returning({ id: quoteParts.id });
    // Yarışı kaybettiysek (parça silindi/sıfırlandı) ortada `failed` bir parça
    // YOKTUR: olmayan bir durumu duyurmak ekrana hayalet satır yazdırırdı.
    if (!failed) return "skipped";
    await recomputeQuoteCache(part.quoteId);
    announce("failed");
    return "failed";
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Takılan parçaları yeniden kuyruğa alır ve kaç parçanın kurtarıldığını döner.
 *
 * İki takılma biçimi vardır ve ikisi de Redis'in unutkanlığındandır: iş hiç
 * eklenememiş (`queued`, kimse almadı) ya da worker işi aldıktan sonra ölmüş
 * (`analyzing`, kilit düştü). Süpürme durumu `queued`'a geri alır ve İŞİ
 * YENİDEN EKLER — saklanan tamamlanmış bir iş aynı kimlikle eklenemediği için
 * kimlik bir sonraki deneme numarasını taşır.
 */
export async function requeueStuckQuoteParts(olderThanMs: number): Promise<number> {
  const now = Date.now();
  const queuedCutoff = new Date(now - olderThanMs);
  const analyzingCutoff = new Date(now - olderThanMs * ANALYZING_GRACE_FACTOR);

  const stuck = await db
    .update(quoteParts)
    .set({ analysisStatus: "queued", updatedAt: new Date() })
    .where(
      and(
        isNull(quoteParts.deletedAt),
        or(
          and(
            eq(quoteParts.analysisStatus, "queued"),
            lt(quoteParts.updatedAt, queuedCutoff)
          ),
          and(
            eq(quoteParts.analysisStatus, "analyzing"),
            lt(quoteParts.updatedAt, analyzingCutoff)
          )
        )
      )
    )
    .returning({ id: quoteParts.id, attempt: quoteParts.analysisAttempt });

  for (const part of stuck) {
    try {
      await enqueuePartAnalysis(part.id, part.attempt + 1, RECOVERY_PRIORITY);
    } catch (err) {
      // Bir parçanın eklenememesi süpürmeyi bitirmesin: kalanlar kurtulsun,
      // bu parçayı bir sonraki tur yeniden bulur.
      console.error(`[quote-analysis] ${part.id} yeniden kuyruğa alınamadı`, err);
    }
  }
  return stuck.length;
}
