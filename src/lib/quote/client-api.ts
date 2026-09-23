/**
 * `/api/quotes/**` uçlarının TARAYICI tarafındaki tek kapısı.
 *
 * Çalışma alanı, hesap sayfaları ve açılış sayfası teklifi buradan okur ve
 * buradan yazar; hiçbir bileşen `fetch("/api/quotes/…")` yazmaz. Sebebi üç
 * tanesi de tek satırda çözülen tekrarlardır:
 *
 *  1. **Paylaşım token'ı**: `?t=` her isteğe eklenmek zorunda; bir uçta
 *     unutulursa paylaşım bağlantısıyla gelen ziyaretçi 404 alır.
 *  2. **Hata cümlesi**: uçlar `{error, code}` döner (global kısıt); her çağıran
 *     kendi `catch`inde bunu yeniden çözmek yerine `QuoteApiError` yakalar.
 *  3. **Taze gövde**: mutasyon uçları teklifin TAZE `PresentedQuote`'unu döner
 *     (bkz. `api/quotes/_shared.ts`), yani her yazımdan sonra ekranın yeniden
 *     okuması gerekmez — dönen gövde doğrudan duruma yazılır.
 *
 * Fiyat kapısı BURADA UYGULANMAZ: fiyat alanları sunucuda ayıklanır
 * (`presentQuote`). Bu dosya yalnız gövdeyi taşır ve fiyat anahtarı olmayan
 * bir gövdeyi olduğu gibi geçirir.
 *
 * Yama tipleri (`PartPatch`, `QuotePatch`, `ReviewRequest`) servis katmanından
 * TİP OLARAK import edilir: ikinci bir tanım, uçla arayüzün sessizce
 * ayrışacağı yerdir. `import type` derlemede silinir, sunucu modülü tarayıcı
 * paketine girmez.
 */
import type { PresentedCatalog, PresentedQuote } from "@/lib/config/quote-types";
import type { SerializedMessage } from "@/lib/services/order-chat";
import type {
  PartPatch,
  QuotePatch,
  ReviewRequest,
  SplitResult,
} from "@/lib/services/quote-service";

export type { PartPatch, QuotePatch, ReviewRequest };

/** Ucun döndürdüğü hata; `code` varsa ekran ona göre dallanabilir. */
export class QuoteApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "QuoteApiError";
    this.status = status;
    this.code = code;
  }
}

/** Uç bir cümle vermediyse (500, boş gövde, ağ) yazılan son çare. */
const GENERIC_ERROR = "İşlem tamamlanamadı. Lütfen tekrar deneyin.";
const OFFLINE_ERROR = "Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.";

export interface QuoteRequestOptions {
  /** `?t=` paylaşım token'ı; sahibinin isteklerinde null. */
  shareToken?: string | null;
  signal?: AbortSignal;
}

function withToken(path: string, shareToken?: string | null): string {
  if (!shareToken) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}t=${encodeURIComponent(shareToken)}`;
}

function base(idOrNumber: string): string {
  return `/api/quotes/${encodeURIComponent(idOrNumber)}`;
}

async function request<T>(
  path: string,
  init: RequestInit,
  opts: QuoteRequestOptions = {}
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(withToken(path, opts.shareToken), {
      credentials: "same-origin",
      signal: opts.signal,
      ...init,
    });
  } catch (e) {
    // İptal edilen istek bir HATA DEĞİLDİR: çağıran (sayfa değişimi, yeni
    // yazım) bilerek kesmiştir ve ekranda kırmızı bir cümle görmemeli.
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new QuoteApiError(OFFLINE_ERROR, 0);
  }

  const body = (await res.json().catch(() => null)) as
    | { error?: unknown; code?: unknown }
    | null;

  if (!res.ok) {
    throw new QuoteApiError(
      typeof body?.error === "string" ? body.error : GENERIC_ERROR,
      res.status,
      typeof body?.code === "string" ? body.code : null
    );
  }
  return body as T;
}

function json(method: string, payload?: unknown): RequestInit {
  return {
    method,
    ...(payload === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }),
  };
}

// ─── Katalog ve teklif oluşturma ────────────────────────────────────────────

/**
 * `GET /api/quotes/catalog` — fiyatsız katalog + bayrak durumu.
 * Bayrak kapalıyken 404 değil `enabled: false` döner (açılış sayfası
 * "Yakında" diyebilsin).
 */
export function fetchQuoteCatalog(
  opts: QuoteRequestOptions = {}
): Promise<{ enabled: boolean; catalog: PresentedCatalog }> {
  return request("/api/quotes/catalog", { method: "GET" }, opts);
}

/**
 * `POST /api/quotes` — boş teklif açar. `termsAccepted` ZORUNLUDUR (uç
 * onaysız gövdeyi 400 ile reddeder): tasarım hakkı / yasaklı ürün / üreticiyle
 * paylaşım onayı ilk yüklemede alınır.
 */
export function createQuote(args: {
  termsAccepted: true;
  turnstileToken: string;
}): Promise<PresentedQuote> {
  return request("/api/quotes", json("POST", args));
}

// ─── Teklif gövdesi ─────────────────────────────────────────────────────────

/** `GET /api/quotes/[id]` — `[id]` uuid ya da `T-000123` olabilir. */
export function fetchQuote(
  idOrNumber: string,
  opts: QuoteRequestOptions = {}
): Promise<PresentedQuote> {
  return request(base(idOrNumber), { method: "GET" }, opts);
}

/** `PATCH /api/quotes/[id]` — başlık, kademe, ek hizmet, not, PO, fatura. */
export function updateQuote(
  idOrNumber: string,
  patch: QuotePatch,
  opts: QuoteRequestOptions = {}
): Promise<PresentedQuote> {
  return request(base(idOrNumber), json("PATCH", patch), opts);
}

/**
 * `POST /api/quotes/[id]/claim` — anonim teklifi giriş yapan hesaba devreder.
 * Teklif başkasının olduğu için devralınamıyorsa uç 404 verir ve burada
 * `QuoteApiError(status 404)` fırlar.
 */
export function claimQuote(
  idOrNumber: string,
  opts: QuoteRequestOptions = {}
): Promise<PresentedQuote> {
  return request(`${base(idOrNumber)}/claim`, json("POST"), opts);
}

/** `POST /api/quotes/[id]/reprice` — bugünün kataloğuyla yeniden fiyatlar. */
export function repriceQuote(
  idOrNumber: string,
  opts: QuoteRequestOptions = {}
): Promise<PresentedQuote> {
  return request(`${base(idOrNumber)}/reprice`, json("POST"), opts);
}

/** `POST /api/quotes/[id]/requote` — aynı parçalarla YENİ teklif açar. */
export function requoteQuote(
  idOrNumber: string,
  opts: QuoteRequestOptions = {}
): Promise<{ number: string }> {
  return request(`${base(idOrNumber)}/requote`, json("POST"), opts);
}

/** `POST /api/quotes/[id]/review` — manuel teklif / RFQ / hedef fiyat. */
export function requestQuoteReview(
  idOrNumber: string,
  body: ReviewRequest,
  opts: QuoteRequestOptions = {}
): Promise<PresentedQuote> {
  return request(`${base(idOrNumber)}/review`, json("POST", body), opts);
}

/** `POST /api/quotes/[id]/share` — paylaşım bağlantısı üret / yenile / iptal. */
export function setQuoteShare(
  idOrNumber: string,
  action: "create" | "rotate" | "revoke",
  opts: QuoteRequestOptions = {}
): Promise<PresentedQuote> {
  return request(`${base(idOrNumber)}/share`, json("POST", { action }), opts);
}

/**
 * `POST /api/quotes/[id]/split` — teklifi teknolojiye göre böler. Cevap hem
 * yeni numaraları hem kaynağın taze gövdesini taşır; `totals` yalnız fiyat
 * görebilen izleyiciye gelir (bölme teklif başına işleyen kalemleri
 * çoğalttığı için toplam büyüyebilir).
 */
export function splitQuoteByTechnology(
  idOrNumber: string,
  opts: QuoteRequestOptions = {}
): Promise<SplitResult & { quote: PresentedQuote }> {
  return request(`${base(idOrNumber)}/split`, json("POST"), opts);
}

// ─── Parçalar ───────────────────────────────────────────────────────────────

/**
 * `POST /api/quotes/[id]/parts` — SAHNELENMİŞ yüklemeyi teklife bağlar.
 * Dosyanın kendisi `/api/uploads/chunk`'a gider (`uploadLargeFile`), buraya
 * yalnız `uploadId` taşınır.
 */
export function addQuotePart(
  idOrNumber: string,
  args: { uploadId: string; fileName: string },
  opts: QuoteRequestOptions = {}
): Promise<PresentedQuote> {
  return request(`${base(idOrNumber)}/parts`, json("POST", args), opts);
}

/** `PATCH …/parts/[partId]` — konfig, ad, not, uyarı onayı, hedef fiyat. */
export function updateQuotePart(
  idOrNumber: string,
  partId: string,
  patch: PartPatch,
  opts: QuoteRequestOptions = {}
): Promise<PresentedQuote> {
  return request(`${base(idOrNumber)}/parts/${encodeURIComponent(partId)}`, json("PATCH", patch), opts);
}

/** `DELETE …/parts/[partId]` — yumuşak siler. */
export function deleteQuotePart(
  idOrNumber: string,
  partId: string,
  opts: QuoteRequestOptions = {}
): Promise<PresentedQuote> {
  return request(
    `${base(idOrNumber)}/parts/${encodeURIComponent(partId)}`,
    { method: "DELETE" },
    opts
  );
}

/** `POST …/parts/[partId]/duplicate` — analiziyle birlikte kopyalar. */
export function duplicateQuotePart(
  idOrNumber: string,
  partId: string,
  opts: QuoteRequestOptions = {}
): Promise<PresentedQuote> {
  return request(
    `${base(idOrNumber)}/parts/${encodeURIComponent(partId)}/duplicate`,
    json("POST"),
    opts
  );
}

/**
 * `POST …/parts/bulk` — seçili parçalara TEK işlemde aynı yamayı uygular
 * (fiyat bir kez hesaplanır, sürüm bir kez artar).
 */
export function bulkUpdateQuoteParts(
  idOrNumber: string,
  partIds: string[],
  patch: PartPatch,
  opts: QuoteRequestOptions = {}
): Promise<PresentedQuote> {
  return request(`${base(idOrNumber)}/parts/bulk`, json("POST", { partIds, patch }), opts);
}

/** `POST …/parts/bulk` (`delete: true`) — seçili parçaları siler. */
export function bulkDeleteQuoteParts(
  idOrNumber: string,
  partIds: string[],
  opts: QuoteRequestOptions = {}
): Promise<PresentedQuote> {
  return request(`${base(idOrNumber)}/parts/bulk`, json("POST", { partIds, delete: true }), opts);
}

/** `POST …/parts/import` — parça kütüphanesinden kopyalar (oturum zorunlu). */
export function importQuoteParts(
  idOrNumber: string,
  sourcePartIds: string[],
  opts: QuoteRequestOptions = {}
): Promise<{ imported: number; quote: PresentedQuote }> {
  return request(`${base(idOrNumber)}/parts/import`, json("POST", { sourcePartIds }), opts);
}

// ─── Teknik çizim (PDF) ─────────────────────────────────────────────────────

function drawingPath(idOrNumber: string, partId: string): string {
  return `${base(idOrNumber)}/parts/${encodeURIComponent(partId)}/drawing`;
}

/** `POST …/drawing` — `multipart/form-data`; `content-type` TARAYICIYA bırakılır. */
export function uploadPartDrawing(
  idOrNumber: string,
  partId: string,
  file: File,
  opts: QuoteRequestOptions = {}
): Promise<PresentedQuote> {
  const form = new FormData();
  form.append("file", file);
  return request(drawingPath(idOrNumber, partId), { method: "POST", body: form }, opts);
}

/** `DELETE …/drawing` — çizimi kaldırır. */
export function removePartDrawing(
  idOrNumber: string,
  partId: string,
  opts: QuoteRequestOptions = {}
): Promise<PresentedQuote> {
  return request(drawingPath(idOrNumber, partId), { method: "DELETE" }, opts);
}

/**
 * Çizimin indirme adresi (`GET …/drawing`). Bağlantı olarak verilir: PDF
 * tarayıcıda açılır, JSON olarak okunmaz.
 */
export function partDrawingUrl(
  idOrNumber: string,
  partId: string,
  shareToken?: string | null
): string {
  return withToken(drawingPath(idOrNumber, partId), shareToken);
}

// ─── Teklif sohbeti ─────────────────────────────────────────────────────────

export interface QuoteMessageList {
  messages: SerializedMessage[];
  unreadCount: number;
}

/** `GET …/messages` — YALNIZ sahip; paylaşım görünümü sohbeti görmez. */
export function fetchQuoteMessages(
  idOrNumber: string,
  opts: QuoteRequestOptions = {}
): Promise<QuoteMessageList> {
  return request(`${base(idOrNumber)}/messages`, { method: "GET" }, opts);
}

/** `POST …/messages` — gövde + isteğe bağlı görsel eki. */
export function sendQuoteMessage(
  idOrNumber: string,
  args: { body: string; file?: File | null },
  opts: QuoteRequestOptions = {}
): Promise<QuoteMessageList> {
  const form = new FormData();
  form.append("body", args.body);
  if (args.file) form.append("file", args.file);
  return request(`${base(idOrNumber)}/messages`, { method: "POST", body: form }, opts);
}

/** `POST …/messages/read` — admin mesajlarını okundu işaretler. */
export function markQuoteMessagesRead(
  idOrNumber: string,
  opts: QuoteRequestOptions = {}
): Promise<{ success: true }> {
  return request(`${base(idOrNumber)}/messages/read`, json("POST"), opts);
}

// ─── Canlı akış ─────────────────────────────────────────────────────────────

/**
 * Teklif odasının SSE adresi. YALNIZ sahibe (oturum ya da anonim çerez)
 * açıktır; paylaşım görünümü bu akışa giremez ve 3 sn'lik yoklamayla çalışır
 * (bkz. `api/realtime/quote/[id]/route.ts`).
 */
export function quoteRealtimeUrl(quoteId: string): string {
  return `/api/realtime/quote/${encodeURIComponent(quoteId)}`;
}
