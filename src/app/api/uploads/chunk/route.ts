import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { quotePricingSettings } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { getPainterSession } from "@/lib/services/painter-auth";
import { quoteApiEnabled } from "@/lib/services/quote-access";
import {
  getAnonymousId,
  getOrCreateAnonymousId,
  getSessionUser,
} from "@/lib/services/customer-auth";
import {
  UPLOAD_CHUNK_SIZE_BYTES,
  appendChunk,
  chargeAnonymousDailyBytes,
  createStagedUpload,
  getStagedUploadMeta,
  isValidUploadId,
  setStagedUploadMeta,
  stagedSize,
  uploadOwnerKey,
} from "@/lib/services/chunked-upload";
import { extractClientIp, rateLimit, rateLimitAsync } from "@/lib/services/rate-limit";
import { handleRouteFailure, UPLOAD_FAILED_ERROR } from "@/lib/api/route-error";

// Streaming route: never let Next try to buffer or cache the body.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Chunked upload endpoint. Any signed-in principal may stage bytes; staging on
 * its own does nothing — the file only becomes real when a feature endpoint
 * (model upload, product file, …) claims the id and validates it.
 *
 * MİSAFİR DE SAHNELEYEBİLİR (anlık teklif motoru): Xometry tarzı akışta ziyaretçi
 * önce dosyayı bırakır, giriş ise fiyatı görmek istediğinde sorulur. Bu yüzden
 * oturumsuz istek artık 401 değil; karşılığında misafirin DÖRT kapısı var — IP
 * ve anonim kimlik başına oran limiti, (çerez + IP) günlük bayt kotası, tek
 * dosya tavanı — ve sahneleme sahibiyle birlikte kaydedilir, böylece bir
 * misafirin yüklemesini başka bir misafir sürdüremez. Girişli çağıranların
 * (admin/üretici/boyacı/müşteri) davranışı bundan etkilenmez: aynı sıra, aynı
 * cevaplar.
 *
 * VE MİSAFİR KAPISI BAYRAĞA BAĞLIDIR. `instant_quote_enabled` kapalıyken bu uç
 * eskisi gibi davranır: oturumsuz her fiil 401. Aksi hâlde yalnız birleştirme,
 * özellik hiç açılmadan, canlı siteye kimliksiz bir "diske yaz" ucu getirirdi.
 *
 * ARIZA MODU DA DEĞİŞMEZ. Bu uç eskiden Redis'e hiç dokunmuyordu; sahiplik
 * defteri onu bir Redis çağrısına bağladı. Paylaşılan bağlantı BullMQ için
 * `maxRetriesPerRequest: null` ile kurulduğundan Redis düştüğünde komutlar
 * reddedilmez, SONSUZA KADAR bekler — yani 300 MB'lık bir panel yüklemesi hiç
 * cevap alamazdı. Bu yüzden buradan çağrılan her Redis yolu üst sınırlıdır
 * (`chunked-upload.ts` → `redisCall`, `boundedRateLimit`) ve sınırı aşınca
 * Redis'siz yola düşer: Redis'siz bir kurulumda yükleme AYNEN çalışır, yalnız
 * misafir kotası uygulanmaz.
 */

/**
 * Oturumlu çağıranın sahiplik anahtarı; oturum yoksa null. Oturum sorgularının
 * SIRASI bilerek eski `isAuthenticated` ile aynıdır.
 */
async function authenticatedOwner(): Promise<string | null> {
  const admin = await auth().catch(() => null);
  const adminUser = admin?.user as { role?: string; email?: string | null } | undefined;
  if (adminUser?.role === "admin") {
    return uploadOwnerKey({ role: "admin", userId: adminUser.email || "admin" });
  }
  const manufacturer = await getManufacturerSession().catch(() => null);
  if (manufacturer) {
    return uploadOwnerKey({ role: "manufacturer", userId: manufacturer.manufacturerId });
  }
  const painter = await getPainterSession().catch(() => null);
  if (painter) return uploadOwnerKey({ role: "painter", userId: painter.painterId });
  const customer = await getSessionUser().catch(() => null);
  if (customer) return uploadOwnerKey({ userId: customer.userId });
  return null;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function tooManyRequests() {
  return NextResponse.json(
    {
      error: "Çok fazla yükleme isteği gönderdiniz. Lütfen bir süre sonra tekrar deneyin.",
      code: "rate_limited",
    },
    { status: 429 }
  );
}

function dailyQuotaExceeded() {
  return NextResponse.json(
    {
      error: "Günlük yükleme sınırına ulaştınız. Yarın tekrar deneyin veya giriş yapın.",
      code: "daily_quota",
    },
    { status: 429 }
  );
}

function notOwner() {
  return NextResponse.json(
    { error: "Bu yükleme oturumu size ait değil.", code: "not_owner" },
    { status: 403 }
  );
}

function sizeExceeded() {
  return NextResponse.json(
    { error: "Dosya bildirilen boyutu aştı.", code: "size_exceeded" },
    { status: 413 }
  );
}

/**
 * Misafir oran limitleri.
 *
 * `PUT` bir sahneleme YUVASI açar (ve diskte bir dosya); `POST` ona bayt ekler.
 * IP başına PUT tavanı yirmi parçalık bir teklifi ve yeniden denemeleri
 * taşıyacak kadar geniş, eski 60/sa'ten belirgin biçimde dar. POST'un bugüne
 * kadar hiç IP limiti yoktu; 100 MB'lık bir dosya 13 parça, IP başına saatte
 * 30 yuva demek ~390 meşru parça — 600 rahat bir tavan.
 *
 * Çerez tavanının IP'den yüksek olması kasıtlı: o EKSEN adres değiştirip
 * çerezini koruyan çağıranı yakalar, tek adresteki tavanı IP limiti koyar.
 */
const GUEST_PUT_PER_IP_HOURLY = 30;
const GUEST_PUT_PER_ANON_HOURLY = 40;
const GUEST_POST_PER_IP_HOURLY = 600;
const HOUR_MS = 3600_000;

/**
 * Misafir kapısı için oran limiti — ama ASILMADAN.
 *
 * `rateLimitAsync` Redis'i BullMQ bağlantısı üzerinden kullanır
 * (`maxRetriesPerRequest: null`): Redis erişilemezken komut reddedilmez,
 * çevrimdışı kuyrukta bekler ve istek hiç cevap dönmez. Kendi `catch`'i bunu
 * yakalayamaz. Bu yüzden çağrıya üst sınır koyuyoruz; sınırı aşarsa modülün
 * kendi belgelenmiş yedeğine — süreç içi sayaca — düşüyoruz. Süreç içi sayaç
 * çok örnekli kurulumda zayıftır, ama kapıyı tamamen açmaktan da, isteği
 * sonsuza kadar askıda tutmaktan da iyidir.
 */
const RATE_LIMIT_TIMEOUT_MS = 1500;

async function boundedRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ success: boolean; remaining: number }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      rateLimitAsync(key, limit, windowMs),
      new Promise<{ success: boolean; remaining: number }>((resolve) => {
        timer = setTimeout(() => {
          console.warn(
            `[uploads/chunk] Oran limiti deposu ${RATE_LIMIT_TIMEOUT_MS} ms içinde yanıtlamadı — süreç içi sayaca düşüldü (${key}).`
          );
          resolve(rateLimit(key, limit, windowMs));
        }, RATE_LIMIT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Bir sözü (promise) üst sınırla bekler; süre dolarsa YA DA çağrı patlarsa
 * `fallback` döner.
 *
 * Gerekçe `boundedRateLimit` ile aynı: bu uç gövdeyi akıtırken hiçbir yardımcı
 * depo için askıda kalamaz. Fark, buradaki yedeğin bir SAYAÇ değil bir KARAR
 * olması — çağıran yedeği bilerek "güvenli taraf" seçer.
 */
async function withDeadline<T>(what: string, run: () => Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run().catch((err) => {
        console.warn(`[uploads/chunk] ${what} okunamadı — yedek değere düşüldü:`, err);
        return fallback;
      }),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => {
          console.warn(
            `[uploads/chunk] ${what} ${RATE_LIMIT_TIMEOUT_MS} ms içinde yanıtlamadı — yedek değere düşüldü.`
          );
          resolve(fallback);
        }, RATE_LIMIT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Misafir kapısı AÇIK MI — ve zaman aşımında KAPALI sayılır.
 *
 * `quoteApiEnabled` (`_shared.ts` ile aynı kapı) bayrağı Redis'ten okur; bu uç
 * o Redis'i bilerek üst sınırladı. Cevap gelmezse kapıyı açık saymak, arızayı
 * "herkese açık diske yaz" hâline çevirirdi — bu yüzden yedek `false`.
 */
const GUEST_GATE_CLOSED = false;

async function guestSurfaceEnabled(): Promise<boolean> {
  return withDeadline("anlık teklif bayrağı", quoteApiEnabled, GUEST_GATE_CLOSED);
}

/**
 * Misafirin TEK sahnelemesi için bayt tavanı (`PricingSettings.maxFileBytes`).
 *
 * Günlük kota 2 GB'tır, ama tek bir yükleme onu tek başına yiyememeli: 100 MB
 * zaten teklife BAĞLANABİLECEK en büyük dosya (`quote-service.ts` claim anında
 * aynı ayara bakar), fazlasını diske almanın karşılığı yok. Ayar yöneticinin
 * elinde olduğu için canlı okunur; her parça için bir sorgu atmamak adına kısa
 * ömürlü önbelleğe alınır. Okunamazsa son bilinen değer, o da yoksa tohumun
 * varsayılanı (`quote-seed.ts` → 100 MB) kullanılır.
 */
const GUEST_FILE_CAP_TTL_MS = 60_000;
const GUEST_FILE_CAP_RETRY_MS = 10_000;
const GUEST_FILE_CAP_FALLBACK_BYTES = 100 * 1024 * 1024;
let guestFileCap = { bytes: GUEST_FILE_CAP_FALLBACK_BYTES, until: 0 };

async function guestFileCapBytes(): Promise<number> {
  if (guestFileCap.until > Date.now()) return guestFileCap.bytes;
  const bytes = await withDeadline<number | null>(
    "teklif fiyat ayarı",
    async () => {
      const [row] = await db
        .select({ maxFileBytes: quotePricingSettings.maxFileBytes })
        .from(quotePricingSettings)
        .where(eq(quotePricingSettings.id, 1))
        .limit(1);
      return row?.maxFileBytes ?? null;
    },
    null
  );
  guestFileCap = {
    bytes: bytes ?? guestFileCap.bytes,
    until: Date.now() + (bytes === null ? GUEST_FILE_CAP_RETRY_MS : GUEST_FILE_CAP_TTL_MS),
  };
  return guestFileCap.bytes;
}

/** İstemcinin `PUT` gövdesinde bildirdiği toplam boyut (isteğe bağlı). */
async function declaredSize(request: NextRequest): Promise<number | null> {
  if (!request.headers.get("content-type")?.includes("json")) return null;
  const body = (await request.json().catch(() => null)) as { size?: unknown } | null;
  const size = Number(body?.size);
  return Number.isFinite(size) && size > 0 ? Math.trunc(size) : null;
}

/** PUT /api/uploads/chunk → { uploadId, chunkSize } */
async function handlePUT(request: NextRequest) {
  let owner = await authenticatedOwner();
  if (!owner) {
    if (!(await guestSurfaceEnabled())) return unauthorized();
    const ip = extractClientIp(request);
    const anonymousId = await getOrCreateAnonymousId();
    const perIp = await boundedRateLimit(`chunk:put:ip:${ip}`, GUEST_PUT_PER_IP_HOURLY, HOUR_MS);
    if (!perIp.success) return tooManyRequests();
    const perAnon = await boundedRateLimit(
      `chunk:put:anon:${anonymousId}`,
      GUEST_PUT_PER_ANON_HOURLY,
      HOUR_MS
    );
    if (!perAnon.success) return tooManyRequests();
    // 0 bayt = salt okuma; kota zaten dolduysa oturumu hiç açma.
    const quota = await chargeAnonymousDailyBytes(anonymousId, 0, ip);
    if (quota.overQuota) return dailyQuotaExceeded();
    owner = uploadOwnerKey({ anonymousId });
  }

  const expectedSize = await declaredSize(request);
  const uploadId = await createStagedUpload();
  await setStagedUploadMeta(uploadId, { owner, expectedSize });
  return NextResponse.json({ uploadId, chunkSize: UPLOAD_CHUNK_SIZE_BYTES });
}

/**
 * POST /api/uploads/chunk?uploadId=…&offset=…
 * Body is the raw chunk (not multipart — multipart would defeat the point).
 */
async function handlePOST(request: NextRequest) {
  const owner = await authenticatedOwner();
  const anonymousId = owner ? null : await getAnonymousId();
  if (!owner && !anonymousId) return unauthorized();

  const ip = extractClientIp(request);
  if (!owner) {
    if (!(await guestSurfaceEnabled())) return unauthorized();
    const perIp = await boundedRateLimit(`chunk:post:ip:${ip}`, GUEST_POST_PER_IP_HOURLY, HOUR_MS);
    if (!perIp.success) return tooManyRequests();
  }

  const uploadId = request.nextUrl.searchParams.get("uploadId") ?? "";
  const offset = Number(request.nextUrl.searchParams.get("offset") ?? "-1");
  if (!isValidUploadId(uploadId) || !Number.isFinite(offset) || offset < 0) {
    return NextResponse.json({ error: "Geçersiz yükleme isteği." }, { status: 400 });
  }

  // Sahiplik KOŞULSUZDUR: sahnelenmiş dosya yalnız onu açan kimliğindir.
  // Karşılaştırmayı misafir koşulunun içine almak, elinde bir yükleme kimliği
  // olan HER girişli çağıranı başkasının sahnelemesine yazar hâle getirir.
  const expected = owner ?? (anonymousId ? uploadOwnerKey({ anonymousId }) : null);
  const meta = await getStagedUploadMeta(uploadId);
  if (!expected || meta?.owner !== expected) return notOwner();

  // BAŞLIK YOKSA NaN: `Number(null)` 0 verir ve uzunluk bildirmeyen (chunked)
  // bir gövde misafir tavanının altından sessizce geçerdi.
  const rawLength = request.headers.get("content-length");
  const declaredLength = rawLength === null ? NaN : Number(rawLength);
  if (anonymousId && (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > UPLOAD_CHUNK_SIZE_BYTES)) {
    // Misafirde parça boyutu SINIRLIDIR: tek istekte diske sınırsız bayt
    // yazdırmak, saatlik oran limitini de günlük kotayı da anlamsız kılardı.
    // 413, istemcinin zaten bildiği "parçayı küçült" işaretidir.
    return NextResponse.json(
      { error: "Yükleme parçası çok büyük.", code: "chunk_too_large" },
      { status: 413 }
    );
  }

  const claimed = Number.isFinite(declaredLength) ? Math.max(0, declaredLength) : 0;
  if (meta.expectedSize != null) {
    if (offset > meta.expectedSize || offset + claimed > meta.expectedSize) return sizeExceeded();
  }

  if (anonymousId) {
    // Boyut bildirmek isteğe bağlıdır, bu yüzden bildirmeyen misafirin tek
    // dosyası da sınırlanmalı: tavan katalogdan gelir (100 MB).
    if (offset + claimed > (await guestFileCapBytes())) return sizeExceeded();
    // Bayt YAZILMADAN ÖNCE işlenir: yazdıktan sonra reddetmek, istemciyi
    // kabul edilmiş bir parçayı tekrar göndermeye iter. Bildirilen uzunluk
    // gerçekleşenden büyük olabilir — kota lehine yanılmak doğrusudur.
    const quota = await chargeAnonymousDailyBytes(anonymousId, declaredLength, ip);
    if (quota.overQuota) return dailyQuotaExceeded();
  }

  const result = await appendChunk(uploadId, request.body, offset);
  if (!result.ok) {
    if (result.reason === "unknown_upload") {
      return NextResponse.json(
        { error: "Yükleme oturumu bulunamadı; baştan başlayın.", code: "unknown_upload" },
        { status: 404 }
      );
    }
    // Tell the client the real offset so it can resume rather than restart.
    return NextResponse.json(
      { error: "Parça sırası uyuşmadı.", code: result.reason, size: result.size },
      { status: 409 }
    );
  }
  return NextResponse.json({ size: result.size });
}

/** GET /api/uploads/chunk?uploadId=… → how many bytes we already hold. */
async function handleGET(request: NextRequest) {
  const owner = await authenticatedOwner();
  const anonymousId = owner ? null : await getAnonymousId();
  if (!owner && !anonymousId) return unauthorized();
  if (!owner && !(await guestSurfaceEnabled())) return unauthorized();

  const uploadId = request.nextUrl.searchParams.get("uploadId") ?? "";
  if (!isValidUploadId(uploadId)) {
    return NextResponse.json({ error: "Geçersiz istek." }, { status: 400 });
  }
  // Sahiplik KOŞULSUZDUR (gerekçe `handlePOST`'ta): sahnelemenin boyutunu da
  // yalnız onu açan kimlik okuyabilir.
  const expected = owner ?? (anonymousId ? uploadOwnerKey({ anonymousId }) : null);
  const meta = await getStagedUploadMeta(uploadId);
  if (!expected || meta?.owner !== expected) return notOwner();

  const size = await stagedSize(uploadId);
  if (size === null) {
    return NextResponse.json({ error: "Bulunamadı" }, { status: 404 });
  }
  return NextResponse.json({ size });
}

/**
 * Beklenmeyen hata = GÖVDESİ OLAN cevap. İş yukarıdaki `handlePUT` içinde
 * yapılır; buradaki tek yakalama, Next'in sıfır baytlık 500'ü yerine ekranın
 * basabileceği TÜRKÇE bir cümle döndürür (gerekçe: src/lib/api/route-error.ts).
 */
export async function PUT(request: NextRequest) {
  try {
    return await handlePUT(request);
  } catch (e) {
    return handleRouteFailure(e, "PUT /api/uploads/chunk", UPLOAD_FAILED_ERROR);
  }
}

/**
 * Beklenmeyen hata = GÖVDESİ OLAN cevap. İş yukarıdaki `handlePOST` içinde
 * yapılır; buradaki tek yakalama, Next'in sıfır baytlık 500'ü yerine ekranın
 * basabileceği TÜRKÇE bir cümle döndürür (gerekçe: src/lib/api/route-error.ts).
 */
export async function POST(request: NextRequest) {
  try {
    return await handlePOST(request);
  } catch (e) {
    return handleRouteFailure(e, "POST /api/uploads/chunk", UPLOAD_FAILED_ERROR);
  }
}

/**
 * Beklenmeyen hata = GÖVDESİ OLAN cevap. İş yukarıdaki `handleGET` içinde
 * yapılır; buradaki tek yakalama, Next'in sıfır baytlık 500'ü yerine ekranın
 * basabileceği TÜRKÇE bir cümle döndürür (gerekçe: src/lib/api/route-error.ts).
 */
export async function GET(request: NextRequest) {
  try {
    return await handleGET(request);
  } catch (e) {
    return handleRouteFailure(e, "GET /api/uploads/chunk", UPLOAD_FAILED_ERROR);
  }
}
