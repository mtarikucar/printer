/**
 * Browser-side analytics tracker. Fires the configured vendor tags (GTM
 * dataLayer + GA4 gtag + Meta fbq + TikTok ttq) and mirrors every event to the
 * server collector for server-side (CAPI / Measurement Protocol) processing,
 * sharing an `event_id` so the platforms can deduplicate.
 *
 * Everything is consent-aware and degrades to a no-op when a tag/consent is
 * absent, so calling `track(...)` is always safe.
 */

import { CURRENCY, ANALYTICS_DEBUG, hasGTM } from "./config";
import { EVENTS, consentCategoryFor, type EventName } from "./events";
import type { ConsentState, TrackPayload } from "./types";
import { ATTR_COOKIE } from "./attribution";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    dataLayer?: any[];
    gtag?: (...args: any[]) => void;
    fbq?: ((...args: any[]) => void) & { callMethod?: (...a: any[]) => void };
    ttq?: any;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const m = document.cookie.match(
    new RegExp("(?:^|; )" + name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1") + "=([^;]*)")
  );
  return m ? decodeURIComponent(m[1]) : undefined;
}

/**
 * Analitiğe GİTMEYECEK sorgu parametreleri.
 *
 * `?t=` teklif paylaşım bağlantısının TAŞIYICI kimlik bilgisidir: teklifi açar
 * ve giriş yapmış bir izleyiciye bütün fiyatları gösterir. Adres çubuğundaki
 * hâliyle `page_location`a girerse GTM/GA4'e (ve kurulu her piksele) gönderilir,
 * oradan üçüncü tarafın günlüklerine ve GA mülkünün URL raporlarına yazılır —
 * saldırgan bir adım atmadan, yalnız bağlantı paylaşıldığı için.
 *
 * Etiket YÜKLEYİCİLERİ de bu listeyi okur (`analytics-scripts.tsx`): liste tek
 * kaynaktır, iki yerde ayrı ayrı yazılırsa biri güncellenmeden kalır.
 */
export const UNTRACKED_QUERY_PARAMS = ["t"];

/**
 * Verilen sorgu dizgisi taşıyıcı kimlik bilgisi taşıyor mu?
 *
 * Bunun `true` olduğu bir adreste HİÇBİR üçüncü taraf etiketi çalıştırılmaz:
 * Meta (`dl`), TikTok ve GTM kabının yerleşik `{{Page URL}}` değişkeni adresi
 * `document.location`dan KENDİLERİ okur ve bunu olay parametresiyle ezmenin
 * desteklenen bir yolu yoktur.
 */
export function hasUntrackedParams(search: string): boolean {
  if (!search) return false;
  const params = new URLSearchParams(search);
  return UNTRACKED_QUERY_PARAMS.some((key) => params.has(key));
}

/**
 * İzlenen adres: yol + kimlik bilgisi AYIKLANMIŞ sorgu dizgisi.
 *
 * Kampanya parametreleri (`utm_*`, `gclid`) aynen kalır; ölçümün asıl işi onlar.
 */
export function buildTrackedUrl(pathname: string, search: string): string {
  if (!search) return pathname;
  const params = new URLSearchParams(search);
  for (const key of UNTRACKED_QUERY_PARAMS) params.delete(key);
  const rest = params.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}

/**
 * Kimlik bilgisi ayıklanmış MUTLAK adres — GA4'ün `page_location` /
 * `page_referrer` alanları mutlak adres bekler.
 *
 * Ayıklanacak bir şey yoksa adres OLDUĞU GİBİ döner: `URL` üzerinden geçirmek
 * sorgu dizgisini yeniden kodlar (`a b` → `a+b`) ve rapordaki adres çubuktakine
 * benzemez olurdu. Çözülemeyen adreste boş dize döner; çağıran alanı hiç
 * göndermez (ham adres göndermektense alan eksik kalsın).
 */
export function buildTrackedHref(href: string): string {
  if (!href) return "";
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return "";
  }
  let removed = false;
  for (const key of UNTRACKED_QUERY_PARAMS) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      removed = true;
    }
  }
  return removed ? url.toString() : href;
}

/**
 * GA4'e / dataLayer'a AÇIKÇA geçilen sayfa alanları.
 *
 * gtag.js gönderdiği her olaya `page_location` ve `page_referrer` değerlerini
 * `document.location` / `document.referrer`dan KENDİSİ ekler. Aynı adları olayın
 * parametrelerinde göndermek otomatik değeri EZER — `buildTrackedUrl` yalnız
 * bizim kendi `pagePath` alanımızı temizlediği için bu ezme olmadan token GA4'e
 * gitmeye devam ederdi.
 */
function trackedPageFields(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const out: Record<string, string> = {};
  const href = buildTrackedHref(window.location.href);
  if (href) {
    out.page_location = href;
    out.page_path = buildTrackedUrl(window.location.pathname, window.location.search);
  }
  const referrer = typeof document !== "undefined" ? document.referrer : "";
  if (referrer) {
    const trackedReferrer = buildTrackedHref(referrer);
    if (trackedReferrer) out.page_referrer = trackedReferrer;
  }
  return out;
}

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "e_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function toMajor(valueKurus?: number): number | undefined {
  return typeof valueKurus === "number" ? Math.round(valueKurus) / 100 : undefined;
}

/** Read the current consent decision straight from the cookie (no React needed). */
function currentConsent(): Pick<ConsentState, "analytics" | "marketing"> {
  const raw = readCookie("fig_consent");
  if (!raw) return { analytics: false, marketing: false };
  try {
    const c = JSON.parse(raw);
    return { analytics: Boolean(c.analytics), marketing: Boolean(c.marketing) };
  } catch {
    return { analytics: false, marketing: false };
  }
}

/** Push to the GTM dataLayer (a no-op until GTM is loaded). */
export function pushDataLayer(obj: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(obj);
}

/**
 * Apply a consent decision to every loaded tag. Called by the consent provider
 * on mount and whenever the user changes their choice.
 */
export function applyConsentToTags(state: Pick<ConsentState, "analytics" | "marketing">): void {
  if (typeof window === "undefined") return;
  const granted = (b: boolean) => (b ? "granted" : "denied");

  // Google Consent Mode v2.
  if (window.gtag) {
    window.gtag("consent", "update", {
      ad_storage: granted(state.marketing),
      ad_user_data: granted(state.marketing),
      ad_personalization: granted(state.marketing),
      analytics_storage: granted(state.analytics),
    });
  }
  // Also surface it on the dataLayer so a GTM container can branch on it.
  pushDataLayer({
    event: "consent_update",
    consent_analytics: state.analytics,
    consent_marketing: state.marketing,
  });

  // Meta pixel consent gating.
  if (window.fbq) window.fbq("consent", state.marketing ? "grant" : "revoke");
}

/** Build the vendor-shaped item array (GA4 items + Meta/TikTok contents). */
function buildItems(p: TrackPayload) {
  if (!p.productId && !p.itemName) return undefined;
  const value = toMajor(p.valueKurus);
  return {
    ga4: [
      {
        item_id: p.productId,
        item_name: p.itemName,
        price: value,
        quantity: p.quantity ?? 1,
      },
    ],
    contents: [
      {
        content_id: p.productId ?? p.reference,
        content_name: p.itemName,
        quantity: p.quantity ?? 1,
        content_price: value,
      },
    ],
  };
}

/**
 * Track a funnel event. Fires the browser tags allowed by the event's `client`
 * routing matrix (subject to consent) and mirrors it to the server collector.
 * Returns the `event_id` used (for callers that need to dedup a paired server
 * event, e.g. a thank-you-page purchase).
 */
export function track(name: EventName, payload: TrackPayload = {}): string {
  const def = EVENTS[name];
  const eventId = payload.eventId ?? newId();
  const consent = currentConsent();
  const category = consentCategoryFor(name);
  const allowed = category === "analytics" ? consent.analytics : consent.marketing;

  const value = toMajor(payload.valueKurus);
  const currency = payload.currency ?? CURRENCY;
  const items = buildItems(payload);
  const visitorId = readCookie(ATTR_COOKIE.visitorId);
  const sessionId = readCookie(ATTR_COOKIE.sessionId);

  if (ANALYTICS_DEBUG) {
    console.debug("[analytics] track", name, { eventId, allowed, ...payload });
  }

  // Adres çubuğunda taşıyıcı kimlik bilgisi varken HİÇBİR tarayıcı etiketi
  // çalıştırılmaz. `page_location`ı ezmek yalnız gtag.js'i kurtarır; Meta (`dl`),
  // TikTok ve GTM kabının `{{Page URL}}` değişkeni adresi kendileri okur ve
  // ezilemez. Aynı yükleyiciler `analytics-scripts.tsx` içinde de bu kapıyla
  // durdurulur — burası, kimliksiz bir belgeden kimlikli bir adrese istemci
  // tarafı geçiş olursa diye ikinci kapıdır. Olay yine de birinci taraf sunucu
  // aynasına (yolu ayıklanmış hâliyle) yazılır, yani ölçüm kaybolmaz.
  const credentialInUrl =
    typeof window !== "undefined" && hasUntrackedParams(window.location.search);
  const page = trackedPageFields();

  if (allowed && typeof window !== "undefined" && !credentialInUrl) {
    // GTM dataLayer (normalised) — let the container fan out if present.
    if (hasGTM) {
      pushDataLayer({
        event: name,
        event_id: eventId,
        value,
        currency,
        product_id: payload.productId,
        item_name: payload.itemName,
        quantity: payload.quantity,
        reference: payload.reference,
        ...payload,
        // Ayıklanmış adres EN SONDA: `payload` bu alanları ezemesin.
        ...page,
      });
    }

    // GA4 (gtag) — engagement events only; purchase is server-side.
    if (def.client.ga4 && window.gtag) {
      const params: Record<string, unknown> = {
        value,
        currency,
        transaction_id: payload.reference,
        ...page,
      };
      if (items) params.items = items.ga4;
      window.gtag("event", def.client.ga4, clean(params));
    }

    // Meta pixel — fire with the shared eventID for CAPI dedup.
    if (def.client.meta && window.fbq) {
      const params: Record<string, unknown> = { value, currency };
      if (items) {
        params.content_type = "product";
        params.contents = items.contents;
        params.content_ids = items.contents.map((c) => c.content_id).filter(Boolean);
      }
      window.fbq("track", def.client.meta, clean(params), { eventID: eventId });
    }

    // TikTok pixel.
    if (def.client.tiktok && window.ttq?.track) {
      const params: Record<string, unknown> = { value, currency };
      if (items) params.contents = items.contents;
      window.ttq.track(def.client.tiktok, clean(params), { event_id: eventId });
    }
  }

  // Always mirror to the server collector (it re-checks consent server-side and
  // stores the event for the admin dashboard regardless of pixel availability).
  mirrorToServer(name, eventId, payload, { visitorId, sessionId, consent });

  return eventId;
}

function clean(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) out[k] = v;
  return out;
}

function mirrorToServer(
  name: EventName,
  eventId: string,
  payload: TrackPayload,
  ctx: {
    visitorId?: string;
    sessionId?: string;
    consent: Pick<ConsentState, "analytics" | "marketing">;
  }
): void {
  if (typeof fetch === "undefined") return;
  const body = JSON.stringify({
    name,
    eventId,
    visitorId: ctx.visitorId,
    sessionId: ctx.sessionId,
    consent: ctx.consent,
    pagePath:
      typeof location !== "undefined"
        ? buildTrackedUrl(location.pathname, location.search)
        : undefined,
    payload,
  });
  try {
    // keepalive lets the request survive a navigation (e.g. checkout redirect).
    fetch("/api/analytics/collect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => {});
  } catch {
    /* never throw from tracking */
  }
}
