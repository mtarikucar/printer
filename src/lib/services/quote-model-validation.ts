import { createHash } from "crypto";

import { UPLOAD_MODEL_FORMATS, type UploadModelFormat } from "@/lib/config/upload";
import { STEP_MAX_BYTES } from "@/lib/config/quote-step";
import type { QuoteSourceFormat, QuoteUnits } from "@/lib/config/quote-types";
import { validateStagedModel } from "@/lib/services/model-file-validation";
import {
  getStagedUploadMeta,
  readStagedHead,
  readStagedRange,
  readStagedTail,
  stagedSize,
} from "@/lib/services/chunked-upload";

/**
 * Teklif motoruna bırakılan model dosyasının KAPISI.
 *
 * STL/OBJ kuralları zaten var (`model-file-validation.ts`) ve burada
 * KOPYALANMAZ — aynı dosya iki yerde farklı davranırsa yükleme akışıyla teklif
 * akışı sessizce ayrışır. Yeni olan tek biçim 3MF'tir.
 *
 * 3MF bir ZIP'tir ve bu onu düşman yapar: tek bir küçük paket açıldığında
 * gigabaytlara şişebilir (zip bombası), şifreli olabilir, ZIP64 olabilir.
 * Bu yüzden BURADA HİÇBİR ŞEY AÇILMAZ. Yalnızca paketin sonundaki merkezi
 * dizin (table of contents) okunur: kaç girdi var, adları ne, hangi yöntemle
 * sıkıştırılmış, açılınca ne kadar yer kaplayacağını İDDİA ediyor. Karar bu
 * iddialara bakılarak verilir; dosyayı gerçekten açmak, kotaları geçmiş ve
 * sahibi belli bir işin (analiz worker'ı, ayrı süreç) işidir.
 *
 * STEP (`.step`/`.stp`) aynı disiplinle eklendi: ISO 10303-21 METİN dosyasıdır,
 * burada AYRIŞTIRILMAZ — yalnız baş/kuyruk okunur (kabuk sağlam mı, DATA
 * bölümü var mı). B-rep yüzeylerini saymak ve OCCT'yi çalıştırmak worker'ın
 * işidir (`scripts/step_mesh.py`). STEP `UPLOAD_MODEL_FORMATS`e GİRMEZ: o
 * liste `/create` yükleyicisini, ürün editörünü ve ZIP tarayıcısını da besler
 * ve tasarım §1 onları bilerek kapsam dışı bırakıyor — bu yüzden STEP dalı
 * 3MF dalının KARDEŞİDİR, o dizinin üyesi değil.
 *
 * Saf sunucu modülü: DB yok, oturum yok. `server-only` DE YOK — çağıran rota
 * zincirinin dışında (betik/test) de çalışabilmeli.
 */

export type QuoteModelValidation =
  | { ok: true; format: QuoteSourceFormat; size: number; sha256: string }
  | { ok: false; error: string; code: string };

export type Quote3mfInspection =
  | { ok: true; entries: number; unit: QuoteUnits | null }
  | { ok: false; code: string };

/** OBJ'nin ilk `f` satırına ulaşmaya yeter (model-file-validation'ın beklentisi). */
const HEAD_BYTES = 256 * 1024;
const TAIL_BYTES = 8 * 1024;

const ZIP_LOCAL_SIG = 0x04034b50;
const ZIP_CD_SIG = 0x02014b50;
const ZIP_EOCD_SIG = 0x06054b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
/** EOCD kaydı (22) + azami zip yorumu (65535). */
const EOCD_SEARCH_BYTES = 65_557;
const MAX_CD_BYTES = 1024 * 1024;
const MAX_CD_ENTRIES = 10_000;
const MAX_TOTAL_UNCOMPRESSED = 1.5 * 1024 * 1024 * 1024;
const MAX_ENTRY_RATIO = 1000;
/** Birim sezgisi için model XML'inin başından okunacak bayt. */
const UNIT_SNIFF_BYTES = 1024;

// ISO 10303-21 değişim dosyasının kabuğu: `ISO-10303-21;` … `HEADER; … ENDSEC;`
// … `DATA; … ENDSEC;` … `END-ISO-10303-21;`. Bölüm adları büyük harfle yazılır
// ama standart büyük/küçük harfi zorlamıyor; kapı bu yüzden harf duyarsız ve
// satır başına bağlı DEĞİL (küçük bir yazıcı tüm dosyayı tek satırda üretse de
// geçerli bir dosyayı reddetmeyelim). Tek istisna ISO imzası: o, dosyanın İLK
// jetonu olmak zorunda.
const STEP_ISO_RE = /^\s*ISO-10303-21\s*;/;
const STEP_ISO_END_RE = /\bEND-ISO-10303-21\s*;/i;
const STEP_HEADER_RE = /\bHEADER\s*;/i;
const STEP_DATA_RE = /\bDATA\s*;/i;
/** `DATA;` hemen `ENDSEC;` ile kapanıyorsa dosyada hiç varlık (gövde) yok. */
const STEP_EMPTY_DATA_RE = /\bDATA\s*;\s*ENDSEC\s*;/i;
const STEP_MAX_MB = Math.floor(STEP_MAX_BYTES / (1024 * 1024));

const MESSAGES: Record<string, string> = {
  unsupported_format: "Yalnız STL, OBJ, 3MF ve STEP dosyaları yüklenebilir.",
  unknown_upload: "Yükleme oturumu bulunamadı; dosyayı tekrar yükleyin.",
  empty_file: "Dosya boş görünüyor; tekrar yükleyin.",
  size_mismatch: "Yükleme tamamlanmadı; dosyayı tekrar yükleyin.",
  too_small: "Dosya çok küçük; geçerli bir 3B model değil.",
  invalid_stl: "STL dosyası okunamadı; dışa aktarmayı tekrarlayıp yeniden deneyin.",
  invalid_obj: "OBJ dosyası okunamadı; dışa aktarmayı tekrarlayıp yeniden deneyin.",
  "3mf_not_zip": "3MF dosyası okunamadı; geçerli bir 3MF paketi değil.",
  "3mf_no_eocd": "3MF paketi eksik indirilmiş görünüyor; dosyayı tekrar yükleyin.",
  "3mf_bad_cd": "3MF paketinin içindekiler listesi okunamadı; yeniden dışa aktarın.",
  "3mf_cd_too_large": "3MF paketi çok fazla girdi içeriyor; sadeleştirip tekrar deneyin.",
  "3mf_cd_entries": "3MF paketi çok fazla girdi içeriyor; sadeleştirip tekrar deneyin.",
  "3mf_zip64": "ZIP64 biçimli 3MF paketleri desteklenmiyor; dosyayı yeniden dışa aktarın.",
  "3mf_encrypted": "Şifreli 3MF paketleri açılamıyor; şifresiz olarak dışa aktarın.",
  "3mf_method":
    "3MF paketinde desteklenmeyen bir sıkıştırma yöntemi var; dosyayı yeniden dışa aktarın.",
  "3mf_no_content_types": "3MF paketi bozuk: [Content_Types].xml bulunamadı.",
  "3mf_no_model": "3MF paketinde 3B model (3D/*.model) bulunamadı.",
  "3mf_bomb":
    "3MF paketi güvenli bulunmadı (açıldığında aşırı büyüyor); dosyayı yeniden dışa aktarın.",
  step_not_iso:
    "Geçerli bir STEP dosyası değil (ISO 10303-21 kabuğu eksik ya da dosya yarım kalmış); CAD programınızdan AP203/AP214 olarak yeniden dışa aktarın.",
  step_no_data:
    "STEP dosyasında DATA bölümü yok; CAD programınızdan AP203/AP214 olarak yeniden dışa aktarın.",
  step_no_geometry:
    "STEP dosyasının DATA bölümü boş; katı gövdeyi (solid) de içerecek şekilde yeniden dışa aktarın.",
  step_too_large: `STEP dosyaları en çok ${STEP_MAX_MB} MB olabilir — STEP aynı boyutta çok daha fazla geometri taşır. Parçayı ayırın ya da STL olarak gönderin.`,
};

const FALLBACK_MESSAGE = "Dosya doğrulanamadı; başka bir dışa aktarım deneyin.";

function fail(code: string, error?: string): QuoteModelValidation {
  return { ok: false, code, error: error ?? MESSAGES[code] ?? FALLBACK_MESSAGE };
}

/**
 * Sahnelenmiş dosyayı doğrular ve kimliğini (sha256) çıkarır.
 *
 * `maxBytes` katalog ayarından gelir (`PricingSettings.maxFileBytes`), burada
 * sabitlenmez: tavanı yönetici değiştirebilmeli.
 */
export async function validateStagedQuoteModel(
  uploadId: string,
  fileName: string,
  maxBytes: number
): Promise<QuoteModelValidation> {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  const is3mf = ext === "3mf";
  // İki uzantı, TEK biçim anahtarı (`"step"`): diskteki ad biçim anahtarından
  // türediği için `.stp` yüklemesi de `quote-parts/<id>/source.step` olur.
  const isStep = ext === "step" || ext === "stp";
  if (!is3mf && !isStep && !UPLOAD_MODEL_FORMATS.includes(ext as UploadModelFormat)) {
    return fail("unsupported_format");
  }

  const size = await stagedSize(uploadId);
  if (size === null) return fail("unknown_upload");
  if (size <= 0) return fail("empty_file");
  if (size > maxBytes) {
    const mb = Math.floor(maxBytes / (1024 * 1024));
    return fail("too_large", `Dosya çok büyük (en fazla ${mb} MB).`);
  }
  // STEP'in İKİNCİ (ve daha düşük) tavanı. Genel tavan bir KATALOG AYARIDIR
  // (yönetici değiştirir, reklam edilen sayı); bu tavan bir DAĞITIM kararıdır:
  // aynı bayt sayısı STEP'te mesh'ten kat kat fazla geometri taşır ve worker'ı
  // ölçen tek şey `mem_limit`tir (ölçüm: `quote-step.ts` `STEP_MAX_BYTES`).
  // İkisi birbirinden BAĞIMSIZ kalmalı — genel tavanı büyütmek STEP'i
  // büyütmez, STEP'i büyütmek önce yeni bir bellek ölçümü ister.
  if (isStep && size > STEP_MAX_BYTES) return fail("step_too_large");

  // İstemci `PUT` sırasında boyut bildirdiyse, diskteki dosya birebir o
  // olmalı: eksik kalmış bir yükleme geçerli ama YARIM bir modeldir.
  const meta = await getStagedUploadMeta(uploadId);
  if (meta?.expectedSize != null && meta.expectedSize !== size) return fail("size_mismatch");

  let format: QuoteSourceFormat;
  if (is3mf) {
    const magic = await readStagedRange(uploadId, 0, 4);
    if (magic.length < 4 || magic.readUInt32LE(0) !== ZIP_LOCAL_SIG) return fail("3mf_not_zip");
    const tailLen = Math.min(EOCD_SEARCH_BYTES, size);
    const tail = await readStagedRange(uploadId, size - tailLen, tailLen);
    const zip = await inspect3mfCentralDirectory(
      tail,
      (off, len) => readStagedRange(uploadId, off, len),
      size
    );
    if (!zip.ok) return fail(zip.code);
    format = "3mf";
  } else if (isStep) {
    // Kararı UZANTI değil İÇERİK verir: `.step` adlı bir ZIP burada düşer.
    // `latin1` bilinçli — STEP ASCII'dir ve 256 KB'ın ortasından kesilen çok
    // baytlı bir dizi utf8 çözümünde jetonları bozabilirdi.
    const head = (await readStagedHead(uploadId, HEAD_BYTES)).toString("latin1");
    const tail = (await readStagedTail(uploadId, TAIL_BYTES)).toString("latin1");
    if (
      !STEP_ISO_RE.test(head) ||
      !STEP_HEADER_RE.test(head) ||
      !STEP_ISO_END_RE.test(tail)
    ) {
      return fail("step_not_iso");
    }
    if (!STEP_DATA_RE.test(head)) return fail("step_no_data");
    if (STEP_EMPTY_DATA_RE.test(head)) return fail("step_no_geometry");
    format = "step";
  } else {
    const head = await readStagedHead(uploadId, HEAD_BYTES);
    const tail = await readStagedTail(uploadId, TAIL_BYTES);
    const result = validateStagedModel(head, tail, size, fileName);
    if (!result.ok || !result.format) return fail(result.error ?? "invalid_model");
    format = result.format;
  }

  return { ok: true, format, size, sha256: await sha256Staged(uploadId, size) };
}

/**
 * 3MF'in (ZIP) merkezi dizinini okur. Hiçbir girdi AÇILMAZ.
 *
 * `tail` dosyanın son ≤65.557 baytı, `readRange` istenen aralığı veren okuyucu,
 * `size` dosyanın gerçek boyutu. Dönüş: girdi sayısı ve — yalnız model girdisi
 * sıkıştırılmamışsa — `<model unit>` özniteliği.
 */
export async function inspect3mfCentralDirectory(
  tail: Buffer,
  readRange: (off: number, len: number) => Promise<Buffer>,
  size: number
): Promise<Quote3mfInspection> {
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === ZIP_EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return { ok: false, code: "3mf_no_eocd" };

  // ZIP64 yerleştiricisi EOCD'den hemen önce, 20 bayt uzunluğunda durur.
  // Kuyruğun tamamını taramak SIKIŞTIRILMIŞ VERİDE rastgele eşleşir ve geçerli
  // dosyaları reddederdi.
  if (eocd >= 20 && tail.readUInt32LE(eocd - 20) === ZIP64_LOCATOR_SIG) {
    return { ok: false, code: "3mf_zip64" };
  }

  const entriesThisDisk = tail.readUInt16LE(eocd + 8);
  const entries = tail.readUInt16LE(eocd + 10);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  // 0xFFFF / 0xFFFFFFFF = "gerçek değer ZIP64 kaydında" nöbetçileri.
  if (
    entries === 0xffff ||
    entriesThisDisk === 0xffff ||
    cdSize === 0xffffffff ||
    cdOffset === 0xffffffff
  ) {
    return { ok: false, code: "3mf_zip64" };
  }
  if (entries > MAX_CD_ENTRIES) return { ok: false, code: "3mf_cd_entries" };
  if (cdSize > MAX_CD_BYTES) return { ok: false, code: "3mf_cd_too_large" };
  if (entries === 0) return { ok: false, code: "3mf_no_model" };
  if (cdSize < 46) return { ok: false, code: "3mf_bad_cd" };
  if (cdOffset + cdSize > size) return { ok: false, code: "3mf_bad_cd" };

  const cd = await readRange(cdOffset, cdSize);
  if (cd.length < cdSize) return { ok: false, code: "3mf_bad_cd" };

  let off = 0;
  let totalUncompressed = 0;
  let hasContentTypes = false;
  let model: { localOffset: number; method: number; uncompressed: number } | null = null;

  for (let i = 0; i < entries; i++) {
    if (off + 46 > cd.length) return { ok: false, code: "3mf_bad_cd" };
    if (cd.readUInt32LE(off) !== ZIP_CD_SIG) return { ok: false, code: "3mf_bad_cd" };

    const flags = cd.readUInt16LE(off + 8);
    const method = cd.readUInt16LE(off + 10);
    const compressed = cd.readUInt32LE(off + 20);
    const uncompressed = cd.readUInt32LE(off + 24);
    const nameLen = cd.readUInt16LE(off + 28);
    const extraLen = cd.readUInt16LE(off + 30);
    const commentLen = cd.readUInt16LE(off + 32);
    const localOffset = cd.readUInt32LE(off + 42);
    const next = off + 46 + nameLen + extraLen + commentLen;
    if (next > cd.length) return { ok: false, code: "3mf_bad_cd" };

    if (flags & 0x0001) return { ok: false, code: "3mf_encrypted" };
    if (method !== 0 && method !== 8) return { ok: false, code: "3mf_method" };
    if (
      compressed === 0xffffffff ||
      uncompressed === 0xffffffff ||
      localOffset === 0xffffffff ||
      hasZip64Extra(cd.subarray(off + 46 + nameLen, off + 46 + nameLen + extraLen))
    ) {
      return { ok: false, code: "3mf_zip64" };
    }
    if (compressed > 0 && uncompressed / compressed > MAX_ENTRY_RATIO) {
      return { ok: false, code: "3mf_bomb" };
    }
    totalUncompressed += uncompressed;
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED) return { ok: false, code: "3mf_bomb" };

    const name = cd.subarray(off + 46, off + 46 + nameLen).toString("utf8");
    if (name.toLowerCase() === "[content_types].xml") hasContentTypes = true;
    if (!model && /^3D\/.*\.model$/i.test(name)) {
      model = { localOffset, method, uncompressed };
    }
    off = next;
  }

  if (!hasContentTypes) return { ok: false, code: "3mf_no_content_types" };
  if (!model) return { ok: false, code: "3mf_no_model" };

  return { ok: true, entries, unit: await sniffUnit(model, readRange, size) };
}

/** Ek alanda ZIP64 genişletilmiş bilgi başlığı (0x0001) var mı? */
function hasZip64Extra(extra: Buffer): boolean {
  let off = 0;
  while (off + 4 <= extra.length) {
    const headerId = extra.readUInt16LE(off);
    const dataSize = extra.readUInt16LE(off + 2);
    if (headerId === 0x0001) return true;
    off += 4 + dataSize;
  }
  return false;
}

/**
 * `<model unit="…">` özniteliği — YALNIZ model girdisi sıkıştırılmamışsa.
 *
 * Deflate'lenmiş girdi açılmaz (bu modülün varlık sebebi), o zaman null döner:
 * birim zaten analiz worker'ının raporundan (`PartGeometry.sourceUnits`) gelir,
 * buradaki okuma yalnızca erken bir ipucudur.
 */
async function sniffUnit(
  model: { localOffset: number; method: number; uncompressed: number },
  readRange: (off: number, len: number) => Promise<Buffer>,
  size: number
): Promise<QuoteUnits | null> {
  if (model.method !== 0 || model.uncompressed <= 0) return null;
  if (model.localOffset + 30 > size) return null;
  const header = await readRange(model.localOffset, 30);
  if (header.length < 30 || header.readUInt32LE(0) !== ZIP_LOCAL_SIG) return null;
  const dataOffset =
    model.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  const want = Math.min(UNIT_SNIFF_BYTES, model.uncompressed, Math.max(0, size - dataOffset));
  if (want <= 0) return null;
  const xml = (await readRange(dataOffset, want)).toString("utf8");
  const match = /<model[^>]*\sunit\s*=\s*"([a-zA-Z]+)"/.exec(xml);
  switch (match?.[1]?.toLowerCase()) {
    case "millimeter":
      return "mm";
    case "centimeter":
      return "cm";
    case "inch":
      return "in";
    default:
      // micron / meter / foot → teklif birimlerimizde karşılığı yok.
      return null;
  }
}

/** Dosyayı parça parça okuyarak sha256 üretir; tamponlanan bayt sabit kalır. */
async function sha256Staged(uploadId: string, size: number): Promise<string> {
  const hash = createHash("sha256");
  const step = 4 * 1024 * 1024;
  let off = 0;
  while (off < size) {
    const buf = await readStagedRange(uploadId, off, Math.min(step, size - off));
    if (buf.length === 0) break; // kısa okuma değil, gerçekten dosya sonu
    hash.update(buf);
    off += buf.length; // istenen değil, OKUNAN kadar ilerle
  }
  return hash.digest("hex");
}
