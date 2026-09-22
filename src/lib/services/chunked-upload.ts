import { createWriteStream } from "fs";
import { mkdir, rm, rename, stat, readdir } from "fs/promises";
import { join, resolve } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { nanoid } from "nanoid";
import { istanbulDateKey } from "@/lib/config/business-days";

/**
 * Chunked upload staging.
 *
 * A 350 MB print model cannot go through `request.formData()`: Next buffers the
 * whole multipart body in memory and `file.arrayBuffer()` then makes a second
 * copy, so one upload costs ~2× the file in RAM and takes the container down.
 * It also has to survive whatever `client_max_body_size` the reverse proxy in
 * front of us happens to carry.
 *
 * So the client slices the file and posts one chunk at a time; each chunk is
 * streamed straight to disk and appended. Memory stays flat regardless of file
 * size, and the proxy only ever sees a chunk-sized request.
 */

const UPLOAD_DIR = resolve(process.env.UPLOAD_DIR || "./uploads");
const STAGING_DIR = join(UPLOAD_DIR, "staging");

/** Chunk size the client should use. Small enough for a modest proxy limit. */
export const UPLOAD_CHUNK_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB

/** Staged uploads older than this are abandoned and swept. */
export const STAGING_TTL_MS = 24 * 60 * 60 * 1000;

function stagingPathFor(uploadId: string): string {
  // uploadId is minted server-side (nanoid), never taken from the client, so it
  // cannot walk out of the staging directory.
  return join(STAGING_DIR, uploadId);
}

/** A staged upload id is an opaque nanoid — reject anything else outright. */
export function isValidUploadId(id: string): boolean {
  return /^[A-Za-z0-9_-]{16,32}$/.test(id);
}

export async function createStagedUpload(): Promise<string> {
  await mkdir(STAGING_DIR, { recursive: true });
  const id = nanoid(24);
  // Create the file up front so appends have something to open.
  await pipeline(Readable.from([]), createWriteStream(stagingPathFor(id)));
  return id;
}

/**
 * Appends one chunk. `expectedOffset` is the byte position the client believes
 * it is writing at; if it disagrees with the file on disk the chunk is refused,
 * which is what makes a retried or out-of-order chunk safe.
 */
export async function appendChunk(
  uploadId: string,
  body: ReadableStream<Uint8Array> | null,
  expectedOffset: number
): Promise<{ ok: true; size: number } | { ok: false; reason: string; size: number }> {
  const path = stagingPathFor(uploadId);
  let current: number;
  try {
    current = (await stat(path)).size;
  } catch {
    return { ok: false, reason: "unknown_upload", size: 0 };
  }
  if (current !== expectedOffset) {
    // Idempotent retry of an already-written chunk, or a lost one. Tell the
    // client where we actually are and let it resume from there.
    return { ok: false, reason: "offset_mismatch", size: current };
  }
  if (!body) return { ok: false, reason: "empty_body", size: current };

  // Stream straight to disk; the chunk never lands in a Buffer.
  await pipeline(
    Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(path, { flags: "a" })
  );
  const size = (await stat(path)).size;
  return { ok: true, size };
}

export async function stagedSize(uploadId: string): Promise<number | null> {
  try {
    return (await stat(stagingPathFor(uploadId))).size;
  } catch {
    return null;
  }
}

/**
 * Moves a completed staged file into its final place under UPLOAD_DIR and
 * returns the storage key. A rename inside the same volume is instant and
 * never reads the bytes.
 */
export async function promoteStagedUpload(
  uploadId: string,
  subdir: string,
  filename: string
): Promise<string> {
  const dir = join(UPLOAD_DIR, subdir);
  await mkdir(dir, { recursive: true });
  const dest = join(dir, filename);
  await rename(stagingPathFor(uploadId), dest);
  return `${subdir}/${filename}`;
}

export async function discardStagedUpload(uploadId: string): Promise<void> {
  await rm(stagingPathFor(uploadId), { force: true });
}

/** Reads the first N bytes of a staged file — enough for magic-byte checks. */
export async function readStagedHead(
  uploadId: string,
  bytes: number
): Promise<Buffer> {
  const { open } = await import("fs/promises");
  const fh = await open(stagingPathFor(uploadId), "r");
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/**
 * Reads an arbitrary byte range of a staged file.
 *
 * A 3MF is a zip: its table of contents sits at the END of the file and points
 * BACKWARDS at each entry. Head/tail samples cannot express that, and reading
 * the whole file would undo the point of streaming it to disk — so the quote
 * validator seeks. The returned buffer is truncated at EOF, never padded.
 */
export async function readStagedRange(
  uploadId: string,
  offset: number,
  length: number
): Promise<Buffer> {
  const { open } = await import("fs/promises");
  const want = Math.max(0, Math.trunc(length));
  if (want === 0) return Buffer.alloc(0);
  const fh = await open(stagingPathFor(uploadId), "r");
  try {
    const buf = Buffer.alloc(want);
    const { bytesRead } = await fh.read(buf, 0, want, Math.max(0, Math.trunc(offset)));
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/** Reads the last N bytes of a staged file (ASCII STL's `endsolid` lives there). */
export async function readStagedTail(
  uploadId: string,
  bytes: number
): Promise<Buffer> {
  const { open } = await import("fs/promises");
  const path = stagingPathFor(uploadId);
  const size = (await stat(path)).size;
  const start = Math.max(0, size - bytes);
  const fh = await open(path, "r");
  try {
    const buf = Buffer.alloc(Math.min(bytes, size));
    const { bytesRead } = await fh.read(buf, 0, buf.length, start);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

// ─── Sahiplik ve kota defteri ───────────────────────────────────────────────
//
// Staging artık misafire de açık (anlık teklif motoru). Dosyanın kendisi
// diskte, ama "bu yüklemeyi kim başlattı" ve "ne kadar bayt bildirdi" bilgisi
// Redis'te durur: birden fazla Next örneği aynı yüklemeyi sürdürebilsin diye.
// Redis yoksa (yerel geliştirme) bellek içi bir harita devreye girer — tek
// süreç için doğrudur, ölçeklenmez; kota ise Redis'siz UYGULANMAZ (aşağıya bak).

export interface StagedUploadMeta {
  /** `uploadOwnerKey` çıktısı: `u:<id>` | `a:<id>` | `<rol>:<id>`. */
  owner: string;
  /** İstemcinin bildirdiği toplam boyut; bildirmediyse null. */
  expectedSize: number | null;
}

/**
 * Sahip anahtarı. Üye `u:`, misafir `a:`, panel oturumları kendi rolleriyle
 * ayrılır — böylece aynı ham kimlik iki farklı sahiplik alanında çakışmaz.
 * Kimliksiz anahtar ÜRETİLMEZ: boş dize depodaki her sahiple eşleşirdi.
 */
export function uploadOwnerKey(v: {
  userId?: string | null;
  anonymousId?: string | null;
  role?: string;
}): string {
  const id = v.userId || v.anonymousId;
  if (!id) throw new Error("uploadOwnerKey: kimlik gerekli");
  if (v.role) return `${v.role}:${id}`;
  return v.userId ? `u:${id}` : `a:${id}`;
}

const memoryMeta = new Map<string, { value: StagedUploadMeta; expiresAt: number }>();

function metaKey(uploadId: string): string {
  return `upload-meta-${uploadId}`;
}

// ─── Redis'e SINIRLI bağımlılık ─────────────────────────────────────────────
//
// `/api/uploads/chunk` bu defterden ÖNCE de çalışıyordu ve Redis düşünce
// çalışmayı SÜRDÜRMELİDİR: 350 MB'lık bir panel yüklemesi sahiplik kaydı
// yüzünden ölmemeli. Ama paylaşılan bağlantı BullMQ için `maxRetriesPerRequest:
// null` ile kurulur (`src/lib/queue/connection.ts`), yani Redis erişilemezken
// komutlar REDDEDİLMEZ — çevrimdışı kuyrukta sonsuza kadar bekler. `try/catch`
// yalnız reddi yakalar, askıyı yakalamaz; bu yüzden her çağrının bir ÜST SINIRI
// var.
//
// Zaman aşımı ayrıca kısa bir devre kesici açar: 350 MB ≈ 44 parça demek, her
// parçada 1,5 sn beklemek Redis kapalıyken yüklemeye dakikalar eklerdi.
const REDIS_CALL_TIMEOUT_MS = 1500;
const REDIS_COOLDOWN_MS = 30_000;
const REDIS_TIMED_OUT = Symbol("redis-timed-out");

let redisColdUntil = 0;

async function getRedisOrNull() {
  if (!process.env.REDIS_URL) return null;
  if (Date.now() < redisColdUntil) return null; // devre kesici açık
  try {
    const mod = await import("@/lib/queue/connection");
    return mod.getRedisConnection();
  } catch {
    return null;
  }
}

type RedisOutcome<T> = { ok: true; value: T } | { ok: false };

/**
 * Bir Redis komutunu zaman sınırıyla çalıştırır. Zaman aşımı veya hata → devre
 * kesici açılır ve `{ ok: false }` döner; çağıran kendi Redis'siz yoluna düşer.
 *
 * Geciken söz (promise) sonradan reddederse yarışın kendi işleyicisi onu
 * yutar — "unhandled rejection" oluşmaz. Zamanlayıcı her durumda temizlenir ki
 * olay döngüsünü boş yere ayakta tutmasın.
 */
async function redisCall<T>(op: string, run: () => Promise<T>): Promise<RedisOutcome<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      run(),
      new Promise<typeof REDIS_TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(REDIS_TIMED_OUT), REDIS_CALL_TIMEOUT_MS);
      }),
    ]);
    if (value === REDIS_TIMED_OUT) {
      redisColdUntil = Date.now() + REDIS_COOLDOWN_MS;
      console.warn(
        `[chunked-upload] Redis ${op} ${REDIS_CALL_TIMEOUT_MS} ms içinde yanıtlamadı — ` +
          `${REDIS_COOLDOWN_MS / 1000} sn boyunca Redis'siz devam ediliyor.`
      );
      return { ok: false };
    }
    return { ok: true, value };
  } catch (err) {
    redisColdUntil = Date.now() + REDIS_COOLDOWN_MS;
    console.warn(`[chunked-upload] Redis ${op} başarısız, Redis'siz devam ediliyor:`, err);
    return { ok: false };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function setStagedUploadMeta(
  uploadId: string,
  meta: StagedUploadMeta
): Promise<void> {
  const redis = await getRedisOrNull();
  if (redis) {
    const written = await redisCall("SET upload-meta", () =>
      redis.set(metaKey(uploadId), JSON.stringify(meta), "PX", STAGING_TTL_MS)
    );
    if (written.ok) return;
  }
  memoryMeta.set(uploadId, { value: meta, expiresAt: Date.now() + STAGING_TTL_MS });
}

export async function getStagedUploadMeta(uploadId: string): Promise<StagedUploadMeta | null> {
  const redis = await getRedisOrNull();
  if (redis) {
    const read = await redisCall("GET upload-meta", () => redis.get(metaKey(uploadId)));
    if (read.ok && read.value) {
      try {
        const parsed = JSON.parse(read.value) as Partial<StagedUploadMeta>;
        if (typeof parsed?.owner === "string") {
          return {
            owner: parsed.owner,
            expectedSize: typeof parsed.expectedSize === "number" ? parsed.expectedSize : null,
          };
        }
      } catch (err) {
        console.warn("[chunked-upload] Redis'teki sahiplik kaydı çözümlenemedi:", err);
      }
    }
  }
  const entry = memoryMeta.get(uploadId);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    memoryMeta.delete(uploadId);
    return null;
  }
  return entry.value;
}

/** Misafir başına günlük sahnelenebilir bayt tavanı. */
export const ANON_DAILY_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

let warnedAboutMissingQuotaStore = false;

/**
 * Misafirin günlük bayt defterine yazar ve toplamı döndürür. `bytes = 0` salt
 * okuma (yüklemeden önceki kapı kontrolü) anlamına gelir.
 *
 * Redis yoksa kota UYGULANMAZ: süreç belleğindeki bir sayaç, birden çok örnek
 * ardında hiçbir şeyi sınırlamaz ve yalnızca yanlış bir güven duygusu verir.
 * Bunun yerine bir kez yüksek sesle uyarıyoruz.
 */
export async function chargeAnonymousDailyBytes(
  anonymousId: string,
  bytes: number
): Promise<{ used: number; overQuota: boolean }> {
  const redis = await getRedisOrNull();
  if (!redis) {
    if (!warnedAboutMissingQuotaStore) {
      warnedAboutMissingQuotaStore = true;
      console.warn(
        "[chunked-upload] Redis kullanılamıyor (REDIS_URL yok ya da devre kesici açık) — " +
          "misafir günlük yükleme kotası uygulanmıyor."
      );
    }
    return { used: 0, overQuota: false };
  }
  const day = istanbulDateKey(new Date()).replaceAll("-", "");
  const key = `chunk:bytes:anon:${anonymousId}:${day}`;
  const used = await redisCall("INCRBY chunk:bytes", () =>
    redis.incrby(key, Math.max(0, Math.trunc(bytes)))
  );
  // Sayaç okunamadıysa kota uygulanamaz; yükleme yine de yürüsün (yukarıdaki
  // gerekçe) — ama `expire` için ikinci bir bekleme daha yaşanmasın.
  if (!used.ok) return { used: 0, overQuota: false };
  // 48 sa: gün İstanbul takvimine göre döner, anahtarın kendisi çöp olmasın.
  await redisCall("EXPIRE chunk:bytes", () => redis.expire(key, 48 * 60 * 60));
  return { used: used.value, overQuota: used.value > ANON_DAILY_UPLOAD_BYTES };
}

/** Drops staged files nobody completed. Called by the cleanup worker. */
export async function sweepStagedUploads(): Promise<number> {
  let names: string[];
  try {
    names = await readdir(STAGING_DIR);
  } catch {
    return 0;
  }
  const cutoff = Date.now() - STAGING_TTL_MS;
  let removed = 0;
  for (const name of names) {
    const p = join(STAGING_DIR, name);
    try {
      const st = await stat(p);
      if (st.mtimeMs < cutoff) {
        await rm(p, { force: true });
        removed++;
      }
    } catch {
      // raced with another sweep; nothing to do
    }
  }
  return removed;
}
