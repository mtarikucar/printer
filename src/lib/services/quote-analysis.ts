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
import { and, asc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { mkdtemp, copyFile, readFile, rm, access } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { db } from "@/lib/db";
import { quoteParts, quotes } from "@/lib/db/schema";
import { ANALYSIS_GIVE_UP_ERROR } from "@/lib/config/quote-types";
import type {
  AnalysisStatus,
  PartGeometry,
  QuoteSourceFormat,
  QuoteUnits,
} from "@/lib/config/quote-types";
import { MeshProcessError, runAnalyzeQuotePart } from "@/lib/services/mesh-runner";
import {
  absoluteFilePath,
  deleteFile,
  saveFile,
  saveFileFromPath,
} from "@/lib/services/storage";
import {
  QUOTE_PART_KEY_PREFIX,
  quotePartKeyReferenced,
} from "@/lib/services/quote-part-files";
import { recomputeQuoteCache } from "@/lib/services/quote-cache";
import { emitQuotePartChanged } from "@/lib/realtime/emit";
import { enqueuePartAnalysis } from "@/lib/queue/quote-queues";

/** Küçük resim WebP kalitesi: 512²'lik izometrik still için gözle aynı, ~4× küçük. */
const THUMBNAIL_QUALITY = 82;
/**
 * Kurtarma süpürmesinde `analyzing` için tanınan süre, `queued` süresinin iki
 * katıdır: sırada bekleyen iş hiç başlamamıştır, çalışan iş python'un altında
 * olabilir ve onu boşuna iki kez çalıştırmak tek çekirdeği israf eder.
 *
 * Bu pencere aynı zamanda VAZGEÇMENİN kapısıdır (bkz. `requeueStuckQuoteParts`):
 * meşru bir analiz python'un 5 dakikalık sert tavanını aşamaz, yani iki katlık
 * pencere dolduğu hâlde hâlâ `analyzing` görünen satır, altında ölmüş bir iştir.
 */
export const ANALYZING_GRACE_FACTOR = 2;

/** Kurtarma yeniden kuyruğa alırken taze müşteri yüklemesinin arkasına geçer. */
const RECOVERY_PRIORITY = 10;

/**
 * Bir süpürmede en çok kaç parça ele alınır.
 *
 * LIMIT'siz bir süpürme, biriken bir artıkta (Redis silindi, worker günlerce
 * kapalı kaldı) tek turda binlerce satırı güncelleyip binlerce iş eklerdi —
 * uzun bir işlem, uzun bir iş kilidi ve concurrency 1'de saatlerce sürecek bir
 * kuyruk. Tavan, bir turda kurtarılanın tek çekirdeğin makul ölçüde
 * öğütebileceği kadar olmasını sağlar; artanı bir sonraki tur alır (en eski
 * önce, yani kimse sıranın sonunda unutulmaz).
 */
export const STUCK_SWEEP_BATCH = 50;

/**
 * Kaçıncı denemeden sonra parçadan VAZGEÇİLİR.
 *
 * TAVAN YALNIZ `analyzing`DE TAKILAN PARÇAYA UYGULANIR (bkz.
 * `requeueStuckQuoteParts`): orada bir worker parçayı gerçekten açmış ve altında
 * ölmüştür, yani delil parçanın kendisindedir. Sırada (`queued`) bekleyen parça
 * sayaç ne olursa olsun yeniden kuyruğa alınır — orada ölçülen şey parçanın
 * sağlığı değil KUYRUĞUN UZUNLUĞUDUR ve onu hiçbir şey sınırlamaz.
 *
 * Sayaç (`analysis_attempt`) iki yerde artar: iş parçayı üstlendiğinde ve
 * süpürme onu geri kuyruğa aldığında. Sürekli çöken bir parça her çökme turunda
 * iki adım ilerler (worker açar + süpürme kurtarır), yani tavana ~6 turda, yani
 * ≈ 6 × `ANALYZING_GRACE_FACTOR` × `STUCK_QUEUED_MS` = 6 saatte varır.
 *
 * Tavan olmasaydı python'u her seferinde öldüren bir dosya sonsuza dek yeniden
 * denenirdi: tek çekirdek boşa dönerdi ve müşteri "inceleniyor" ekranında
 * sonsuza dek beklerdi. `failed` demek, hiç cevap vermemekten iyidir — müşteri
 * yeni bir dosya yükleyebilir, admin manuel fiyat girebilir.
 *
 * BİLİNEN ARTIK: sayaç TEKTİR ve monoton artar, çünkü iş kimliği sözleşmesi
 * (`…-r<deneme>`) ona bağlıdır ve sıfırlanamaz. Bu yüzden uzun bir kuyrukta
 * beklemek de bütçeyi tüketir: saatlerce bekleyip SONRA bir kez çöken parça, tek
 * gerçek çökmeden sonra vazgeçilebilir. Artığı tamamen kaldırmak ikinci bir
 * sayaç kolonu (yeni migration) ister; kapı `analyzing`e daraltıldığı için
 * kalan durum "worker gerçekten açtı ve öldü"dür, "hiç açılmadı" değil.
 */
export const MAX_ANALYSIS_ATTEMPTS = 10;

/** Süpürmenin bir turda ne yaptığı: kaç parça geri kuyruğa girdi, kaçından vazgeçildi. */
export interface StuckSweepResult {
  requeued: number;
  gaveUp: number;
}

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
 * bir yazım hatası gerçek bir arızadır ve `failed` olarak görünmelidir. Bu
 * yüzden küçük resmin `try`ı yalnız DÖNÜŞTÜRMEYİ (sharp) sarar; `saveFile`
 * dışarıda durur ve hatası aşağıdaki toplayıcıya ulaşır. İçeriye alınsaydı
 * yarım yazılmış webp'yi kimse silmezdi — yutulan hata, sızdıran hatadır.
 *
 * YARIDA KALAN YAZIM KENDİNİ TOPLAR: fırlamadan önce O ÇAĞRIDA ayrılmış ne
 * varsa silinir. Anahtar YAZIMDAN ÖNCE deftere girer (`reserve`), çünkü
 * yazımın ortasında ölen çağrı (ENOSPC/EIO) hedef dosyayı AÇMIŞ ve YARIM
 * bırakmış olur: `saveFileFromPath` = mkdir + copyFile, `saveFile` =
 * mkdir + writeFile. Anahtar yazımdan SONRA kaydedilse, kaydedilmeyen tek
 * anahtar tam da sızdıran yazımın anahtarı olurdu; dosya diskte kalır, hiçbir
 * satır onu göstermez — yani ne saklama süpürmesi (satırdan okur) ne de yetim
 * dizin süpürmesi (parçanın satırı DURUYOR) onu bir daha bulabilir.
 *
 * Önden kaydetmek bedelsizdir: anahtarlar bu çağrıda üretilmiştir (`nanoid`),
 * henüz hiçbir satıra yazılmamıştır ve `deleteFile` olmayan dosyaya sessizdir
 * (`rm --force`), yani hiç açılmamış bir anahtarı silmek de zararsızdır.
 *
 * `export` sözleşmenin parçasıdır: bu yarım-yazım yolu yalnız buradan
 * kurulabildiği için `scripts/test-quote-analysis-db.ts` işlevi doğrudan çağırır.
 */
export async function storeAnalysisOutputs(
  partId: string,
  work: string,
  onLog?: (line: string) => void
): Promise<StoredOutputs> {
  const subdir = `${QUOTE_PART_KEY_PREFIX}/${partId}`;
  const written: string[] = [];
  /** Anahtarı yazımdan ÖNCE deftere yazar ve tam anahtarı döner. */
  const reserve = (filename: string): string => {
    const key = `${subdir}/${filename}`;
    written.push(key);
    return key;
  };
  try {
    const canonicalName = `canonical-${nanoid(8)}.stl`;
    const canonicalStlKey = reserve(canonicalName);
    await saveFileFromPath(join(work, "canonical.stl"), subdir, canonicalName);

    let previewGlbKey: string | null = null;
    const glbPath = join(work, "preview.glb");
    if (await exists(glbPath)) {
      const previewName = `preview-${nanoid(8)}.glb`;
      previewGlbKey = reserve(previewName);
      await saveFileFromPath(glbPath, subdir, previewName);
    } else {
      onLog?.("preview.glb yok — önizleme atlandı");
    }

    let thumbnailKey: string | null = null;
    const pngPath = join(work, "thumb.png");
    if (await exists(pngPath)) {
      let webp: Buffer | null = null;
      try {
        // KOZMETİK olan yalnız bu: PNG okunamaz/çevrilemezse küçük resim yok.
        webp = Buffer.from(
          await sharp(await readFile(pngPath)).webp({ quality: THUMBNAIL_QUALITY }).toBuffer()
        );
      } catch (err) {
        onLog?.(`küçük resim atlandı: ${(err as Error).message}`);
      }
      if (webp) {
        const thumbName = `thumb-${nanoid(8)}.webp`;
        thumbnailKey = reserve(thumbName);
        await saveFile(webp, subdir, thumbName);
      }
    } else {
      onLog?.("thumb.png yok — küçük resim atlandı");
    }

    return { canonicalStlKey, previewGlbKey, thumbnailKey };
  } catch (err) {
    for (const key of written) {
      await deleteFile(key).catch((cleanupErr) =>
        console.error(`[quote-analysis] yarım çıktı ${key} silinemedi`, cleanupErr)
      );
    }
    throw err;
  }
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
 * ÜZERİNE YAZILAN eski çıktıları siler.
 *
 * Kurtarma süpürmesi takılan bir parçayı `queued`a geri alır ve iş yeniden
 * koşar; ikinci tur üç anahtarı da YENİ adlarla yazar (`nanoid`). Eski adlar o
 * anda hiçbir satırda kalmaz: saklama süpürmesi yalnız satırlardan okuduğu
 * anahtarları sildiği için o dosyalar diskte sonsuza dek kalırdı.
 *
 * `previous` KAPI ALTINDAKİ satırdan gelir (üstlenme `UPDATE … RETURNING`'i),
 * yani silinen anahtarlar bu işin gerçekten üzerine yazdığı anahtarlardır.
 *
 * İki kapı var ve ikisi de gerekli: yeni anahtarlardan biriyle aynı olan bir
 * anahtar silinmez (aynı dosya), ve BAŞKA bir satırın gösterdiği anahtar
 * silinmez (`duplicatePart` kopyaya aynı anahtarları verir — silmek ötekini
 * dosyasız bırakırdı). Referans sayımı okunamazsa dosya KORUNUR: silme geri
 * alınamaz, artık ise bir sonraki yeniden analizde yine adaydır.
 */
async function deleteSupersededOutputs(
  previous: { canonicalStlKey: string | null; previewGlbKey: string | null; thumbnailKey: string | null },
  stored: StoredOutputs
): Promise<void> {
  const fresh = new Set(
    [stored.canonicalStlKey, stored.previewGlbKey, stored.thumbnailKey].filter(
      (key): key is string => key !== null
    )
  );
  const superseded = new Set(
    [previous.canonicalStlKey, previous.previewGlbKey, previous.thumbnailKey].filter(
      (key): key is string => key !== null && key !== "" && !fresh.has(key)
    )
  );
  for (const key of superseded) {
    let referenced: boolean;
    try {
      referenced = await quotePartKeyReferenced(key);
    } catch (err) {
      console.error(`[quote-analysis] ${key} referans sayımı okunamadı, dosya korundu`, err);
      continue;
    }
    if (referenced) continue;
    await deleteFile(key).catch((err) =>
      console.error(`[quote-analysis] eski çıktı ${key} silinemedi`, err)
    );
  }
}

/**
 * Analiz bittiğinde birimi YALNIZ dosya söylüyorsa ve müşteri henüz
 * dokunmadıysa düzeltir.
 *
 * 3MF kendi birimini beyan eder; STL/OBJ etmez (`sourceUnits = null`). Koşul
 * güncellemenin İÇİNDE, `CASE` ile kurulur: müşteri analiz sürerken birimi
 * elle değiştirmiş olabilir ve iş onun seçimini ezmemelidir.
 *
 * STEP'TE İSTİSNA: birim müşterinin seçimi DEĞİL, dosyanın kendisidir (ISO
 * 10303 uzunluk birimi; çekirdek onu mm'ye uygular) — ve 0070'in
 * `quote_parts_step_units_chk` CHECK'i satırda `units <> 'mm'` GÖRMEK
 * İSTEMEZ. Aşağıdaki `CASE` müşterinin seçimini KORUR; STEP'te korumak, bu
 * UPDATE'i `23514` ile düşürür, parça `MAX_ANALYSIS_ATTEMPTS` turu boyunca
 * yeniden denenir ve sonunda `failed` olurdu. Bu yüzden STEP'te mm
 * KOŞULSUZ yazılır (PATCH tarafındaki eşi: `resolveConfig`, quote-service.ts).
 */
function unitsPatch(geometry: PartGeometry, sourceFormat: QuoteSourceFormat) {
  if (sourceFormat === "step") return { units: "mm" as QuoteUnits };
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
    const stored = await storeAnalysisOutputs(partId, work, onLog);

    const [ready] = await db
      .update(quoteParts)
      .set({
        analysisStatus: "ready",
        analysisError: null,
        geometry,
        canonicalStlKey: stored.canonicalStlKey,
        previewGlbKey: stored.previewGlbKey,
        thumbnailKey: stored.thumbnailKey,
        ...unitsPatch(geometry, part.sourceFormat),
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

    // Satır artık YENİ anahtarları taşıyor: üzerine yazılan eskiler burada gider.
    await deleteSupersededOutputs(part, stored);

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
 * Takılan parçaları yeniden kuyruğa alır; İŞİNİ ALTINDA ÖLDÜREN parçadan vazgeçer.
 *
 * İki takılma biçimi vardır ve AYRI ele alınırlar, çünkü taşıdıkları delil
 * farklıdır:
 *
 * 1. **`queued` + eskimiş** — iş hiç başlamadı. Bunun İKİ sebebi olabilir ve
 *    veritabanından ayırt EDİLEMEZ: Redis işi düşürdü, ya da kuyruk uzun ve
 *    parçanın sırası gelmedi. Kuyruğun KÜRESEL uzunluğunu hiçbir şey
 *    sınırlamaz — `maxPartsPerQuote` tek bir yüklemeyi sınırlar, aynı anda kaç
 *    müşterinin yüklediğini değil; bir kesinti sonrası artık da buraya birikir —
 *    yani "uzun süredir sırada" tek başına parça hakkında HİÇBİR ŞEY söylemez.
 *    Bu dalda bu yüzden VAZGEÇME YOKTUR: parça sayacı ne olursa olsun yeniden
 *    kuyruğa alınır. Yanılmanın bedeli ucuzdur (fazladan iş parçayı `queued`
 *    bulamayıp `"skipped"` döner); vazgeçmenin bedeli onarılamaz: okunabilir bir
 *    dosyaya "Dosya okunamadı" yazılır, teklif fiyatlanamaz ve
 *    `analysis_attempt`i sıfırlayan tek bir yol bile yoktur.
 * 2. **`analyzing` + eskimiş** (`ANALYZING_GRACE_FACTOR` katı pencere) — iş
 *    BAŞLADI ve worker altında öldü. Meşru bir analiz bu kadar süremez
 *    (python'un sert tavanı 5 dk, sonra SIGKILL), yani burada delil parçanın
 *    kendisindedir. W5'in hedeflediği "işini her seferinde öldüren dosya" YALNIZ
 *    bu dalda görünür, bu yüzden `MAX_ANALYSIS_ATTEMPTS` tavanı YALNIZ buraya
 *    uygulanır.
 *
 * Her iki dalda da süpürme durumu `queued`'a geri alır ve İŞİ YENİDEN EKLER.
 *
 * DENEME SAYACI BURADA DA ARTAR, ve bu süpürmenin işe yaramasının tek
 * koşuludur: iş kimliği `…-r<deneme>`dir, bullmq aynı özel kimlikle ikinci bir
 * eklemeyi SESSİZCE yutar (`addStandardJob-9.lua` → `handleDuplicatedJob`) ve
 * `removeOnFail: {count:500}` yüzünden eski kimlik haftalarca Redis'te durur.
 * Sayaç artmasaydı `queued`'da takılan bir parça her turda aynı kimliğe
 * eklenir, hiç çalışmaz, ama süpürme "kurtarıldı" diye sayardı: müşteri
 * fiyatını sonsuza dek beklerdi. Artan sayaç her tura yeni bir kimlik verir —
 * sayaç tavanın ÜSTÜNDE olsa bile (bekleyen parça için tavan diye bir şey yok).
 *
 * VAZGEÇME aynı sayacın öteki yüzüdür: `analyzing`de takılmış ve
 * `MAX_ANALYSIS_ATTEMPTS`e ulaşmış parça yeniden denenmez, `failed` yazılır
 * (`analysis_error = stuck_retry_limit`). Yoksa python'u her çalıştırmada
 * öldüren bir dosya tek çekirdeği sonsuza dek meşgul eder ve müşteri hiç cevap
 * alamazdı. Vazgeçilen parça müşteriye "dosya okunamadı, yeniden yükleyin"
 * olarak görünür (DfM `analysis_failed`).
 *
 * `limit` bir turda ele alınan parça sayısını sınırlar ve en ESKİ dokunulandan
 * başlar: sınırın dışında kalan bir sonraki turun başına geçer. İki dal sınırı
 * AYRI uygular — bir tur en çok `limit` parçayı kurtarır ve en çok `limit`
 * parçadan vazgeçer.
 */
export async function requeueStuckQuoteParts(
  olderThanMs: number,
  limit: number = STUCK_SWEEP_BATCH
): Promise<StuckSweepResult> {
  const now = Date.now();
  const queuedCutoff = new Date(now - olderThanMs);
  const analyzingCutoff = new Date(now - olderThanMs * ANALYZING_GRACE_FACTOR);
  const alive = isNull(quoteParts.deletedAt);
  /** Sırada unutulmuş VEYA sırası gelmemiş: ikisi ayırt edilemez (§1). */
  const stuckQueued = and(
    alive,
    eq(quoteParts.analysisStatus, "queued"),
    lt(quoteParts.updatedAt, queuedCutoff)
  );
  /** İş başladı ve worker öldü: parçanın kendisi delil (§2). */
  const stuckAnalyzing = and(
    alive,
    eq(quoteParts.analysisStatus, "analyzing"),
    lt(quoteParts.updatedAt, analyzingCutoff)
  );
  /**
   * Tur başına sınır: UPDATE'in kendisi LIMIT almaz, sınır en ESKİ dokunulandan
   * başlayan bir alt sorgudan gelir (depodaki `claimReminders` deseni).
   *
   * Koşul UPDATE'in kendi WHERE'inde İKİNCİ kez kurulur ve bu bilinçlidir:
   * postgres satırı kilitledikten sonra WHERE'i satırın YENİ hâline karşı
   * yeniden değerlendirir, yani aynı anda koşan iki süpürme aynı parçayı iki kez
   * saymaz (ikincisi tazelenmiş `updated_at`i görüp satırı atlar). Yalnız
   * `id IN (…)` yazılsaydı sayaç iki kez artar ve iki iş eklenirdi.
   */
  const claim = (target: SQL | undefined) =>
    and(
      target,
      inArray(
        quoteParts.id,
        db
          .select({ id: quoteParts.id })
          .from(quoteParts)
          .where(target)
          .orderBy(asc(quoteParts.updatedAt))
          .limit(limit)
      )
    );
  // Vazgeçme kapısı: YALNIZ `analyzing` dalı + tükenmiş bütçe. Kurtarma kapısı:
  // bekleyen her parça (bütçesizdir) + bütçesi kalan çökmüş parça. İkisi
  // kesişmez, yani sıralama bir yarış yaratmaz.
  const giveUpTarget = and(
    stuckAnalyzing,
    gte(quoteParts.analysisAttempt, MAX_ANALYSIS_ATTEMPTS)
  );
  const rescueTarget = or(
    stuckQueued,
    and(stuckAnalyzing, lt(quoteParts.analysisAttempt, MAX_ANALYSIS_ATTEMPTS))
  );

  // 1. VAZGEÇ: işi altında ölmüş ve sayacı tavana vurmuş parçalar nihai `failed`.
  //    Sayaç ARTMAZ: artan sayaç "bir kez daha denedik" demek olurdu.
  const givenUp = await db
    .update(quoteParts)
    .set({
      analysisStatus: "failed",
      analysisError: ANALYSIS_GIVE_UP_ERROR,
      updatedAt: new Date(),
    })
    .where(claim(giveUpTarget))
    .returning({ id: quoteParts.id, quoteId: quoteParts.quoteId });

  // 2. KURTAR: kalanlar `queued`'a döner ve işleri yeniden eklenir.
  const stuck = await db
    .update(quoteParts)
    .set({
      analysisStatus: "queued",
      analysisAttempt: sql`${quoteParts.analysisAttempt} + 1`,
      updatedAt: new Date(),
    })
    .where(claim(rescueTarget))
    // `RETURNING` güncellenmiş satırı verir: `attempt` zaten artmış değerdir.
    .returning({ id: quoteParts.id, attempt: quoteParts.analysisAttempt });

  for (const part of stuck) {
    try {
      await enqueuePartAnalysis(part.id, part.attempt, RECOVERY_PRIORITY);
    } catch (err) {
      // Bir parçanın eklenememesi süpürmeyi bitirmesin: kalanlar kurtulsun,
      // bu parçayı bir sonraki tur yeniden bulur.
      console.error(`[quote-analysis] ${part.id} yeniden kuyruğa alınamadı`, err);
    }
  }

  // Analiz worker'ının kendi `failed` yolunda yaptığının aynısı: önbellek
  // yenilenir, sonra ekranlara haber verilir. Atlanırsa müşterinin açık sayfası
  // "inceleniyor" iskeletinde donar — parça artık asla ilerlemeyecekken.
  await announceGiveUps(givenUp);

  return { requeued: stuck.length, gaveUp: givenUp.length };
}

/** Vazgeçilen parçaların tekliflerini yeniden hesaplar ve ekranlara haber verir. */
async function announceGiveUps(
  parts: Array<{ id: string; quoteId: string }>
): Promise<void> {
  if (parts.length === 0) return;
  const quoteIds = [...new Set(parts.map((p) => p.quoteId))];
  const owners = new Map(
    (
      await db
        .select({ id: quotes.id, userId: quotes.userId })
        .from(quotes)
        .where(inArray(quotes.id, quoteIds))
    ).map((row) => [row.id, row.userId])
  );
  for (const quoteId of quoteIds) {
    // Tek teklifin düşmesi kalanları düşürmesin: süpürme bir bakım turudur.
    await recomputeQuoteCache(quoteId).catch((err) =>
      console.error(`[quote-analysis] ${quoteId} önbelleği yenilenemedi`, err)
    );
  }
  for (const part of parts) {
    console.error(
      `[quote-analysis] ${part.id} deneme tavanını aştı (${MAX_ANALYSIS_ATTEMPTS}) — failed`
    );
    emitQuotePartChanged({
      quoteId: part.quoteId,
      partId: part.id,
      status: "failed",
      userId: owners.get(part.quoteId) ?? null,
    });
  }
}
