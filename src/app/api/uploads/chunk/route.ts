import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { getPainterSession } from "@/lib/services/painter-auth";
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
 * oturumsuz istek artık 401 değil; karşılığında misafirin ÜÇ kapısı var — IP ve
 * anonim kimlik başına oran limiti, günlük bayt kotası — ve sahneleme sahibiyle
 * birlikte kaydedilir, böylece bir misafirin yüklemesini başka bir misafir
 * sürdüremez. Girişli çağıranların (admin/üretici/boyacı/müşteri) davranışı
 * bundan etkilenmez: aynı sıra, aynı cevaplar.
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
    const ip = extractClientIp(request);
    const anonymousId = await getOrCreateAnonymousId();
    const perIp = await boundedRateLimit(`chunk:put:ip:${ip}`, 60, 3600_000);
    if (!perIp.success) return tooManyRequests();
    const perAnon = await boundedRateLimit(`chunk:put:anon:${anonymousId}`, 40, 3600_000);
    if (!perAnon.success) return tooManyRequests();
    // 0 bayt = salt okuma; kota zaten dolduysa oturumu hiç açma.
    const quota = await chargeAnonymousDailyBytes(anonymousId, 0);
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

  const uploadId = request.nextUrl.searchParams.get("uploadId") ?? "";
  const offset = Number(request.nextUrl.searchParams.get("offset") ?? "-1");
  if (!isValidUploadId(uploadId) || !Number.isFinite(offset) || offset < 0) {
    return NextResponse.json({ error: "Geçersiz yükleme isteği." }, { status: 400 });
  }

  const meta = await getStagedUploadMeta(uploadId);
  // Misafirin yüklemesini yalnız o misafir sürdürebilir.
  if (anonymousId && meta?.owner !== uploadOwnerKey({ anonymousId })) return notOwner();

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

  if (meta?.expectedSize != null) {
    const claimed = Number.isFinite(declaredLength) ? Math.max(0, declaredLength) : 0;
    if (offset > meta.expectedSize || offset + claimed > meta.expectedSize) {
      return NextResponse.json(
        { error: "Dosya bildirilen boyutu aştı.", code: "size_exceeded" },
        { status: 413 }
      );
    }
  }

  if (anonymousId) {
    // Bayt YAZILMADAN ÖNCE işlenir: yazdıktan sonra reddetmek, istemciyi
    // kabul edilmiş bir parçayı tekrar göndermeye iter. Bildirilen uzunluk
    // gerçekleşenden büyük olabilir — kota lehine yanılmak doğrusudur.
    const quota = await chargeAnonymousDailyBytes(anonymousId, declaredLength);
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

  const uploadId = request.nextUrl.searchParams.get("uploadId") ?? "";
  if (!isValidUploadId(uploadId)) {
    return NextResponse.json({ error: "Geçersiz istek." }, { status: 400 });
  }
  if (anonymousId) {
    const meta = await getStagedUploadMeta(uploadId);
    if (meta?.owner !== uploadOwnerKey({ anonymousId })) return notOwner();
  }
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
