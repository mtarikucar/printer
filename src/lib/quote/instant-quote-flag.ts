"use client";

/**
 * Anlık teklif motorunun TARAYICI tarafındaki tek bayrak sondası.
 *
 * Bayraklar sunucuda yaşar (admin `/admin/ayarlar`'dan çevirir) ve ÇALIŞMA
 * ZAMANINDA değişir; `next.config` yönlendirmesi derleme anında sabitlendiği
 * için bayrağı izleyemez. Geçişi bu yüzden bileşenler yapar: sayfa açıldığında
 * `GET /api/quotes/catalog` sorulur — bayrak kapalıyken 404 dönmeyen tek uç
 * odur (bkz. `app/api/quotes/catalog/route.ts`), yani "kapalı" cevabı da
 * alınabilir. Cevap ayrıca izleyiciye göredir: admin oturumunda bayrak kapalı
 * olsa bile `enabled: true` gelir (iç test), müşteri 404'e götüren bağlantı
 * görmez.
 *
 * Sonuç MODÜL DÜZEYİNDE tutulur çünkü aynı sayfada dört ayrı yüzey (üst menü,
 * footer, yol seçici, eski yükleme akışı) aynı soruyu sorar; paylaşılmasa bir
 * sayfa açılışı dört isteğe çıkardı. Uçuştaki istek de paylaşılır: aynı anda
 * mount olan bileşenler tek `fetch` bekler.
 *
 * ─── İKİ BAYRAK, HÂLÂ TEK `fetch` (0072) ───────────────────────────────────
 *
 * Takım çalışma alanı AYRI bir bayraktır (`quote_teams_enabled`) ve
 * `/account/takim` bağlantısı ona tabidir: `instant_quote_enabled` AÇIK ama
 * takım KAPALI hâli gerçek bir hâldir (ve bugün olacak olan hâldir). Yine de
 * sonda İKİNCİ bir istek ATMAZ — cevabın bir alanı olarak gelir
 * (`teamsEnabled`), tıpkı S sevkiyatının STEP kapısını `acceptedFormats` ile
 * katalog GÖVDESİNE koyması gibi. Önbellek bu yüzden düz bir `boolean` değil
 * iki alanlı bir nesne; `scripts/test-quote-cutover.ts` fetch SAYACIYLA
 * ölçüyor.
 *
 * `teamsEnabled` cevaba YALNIZ `enabled: true` dalında giriyor (uç, kapalı
 * hâlde ikinci bir bayrak okuması yapmıyor: `SiteHeader` her genel sayfada
 * mount oluyor). Yani teklif motoru kapalıyken takım da "kapalı" okunur. Bu
 * DARALTAN yön bilinçli: bağlantıyı GİZLEMEK hiçbir hâlde 404 üretmez, ve
 * bağlanacak teklifi olmayan bir takım yüzeyinin menüde durmasının anlamı yok.
 *
 * Sunucuda (SSR/RSC) önbellek HİÇ dolmaz — sondayı yalnız `useEffect`
 * çalıştırır, efekt de yalnız tarayıcıda çalışır. Bu yüzden ilk HTML her zaman
 * "bilinmiyor" hâliyle üretilir ve hidrasyon uyuşmazlığı doğmaz.
 */
import { useEffect, useState } from "react";
import { fetchQuoteCatalog } from "@/lib/quote/client-api";

/** Sondanın tek cevabı: iki bayrak, tek istek. */
interface QuoteFlagProbe {
  quote: boolean;
  teams: boolean;
}

/** Hata "kapalı" DEĞİL "bilinmiyor"dur — bu değer önbelleğe YAZILMAZ. */
const UNKNOWN: QuoteFlagProbe = { quote: false, teams: false };

let cached: QuoteFlagProbe | null = null;
let inFlight: Promise<QuoteFlagProbe> | null = null;

/** Sondanın bilinen cevabı; henüz sorulmadıysa `null`. */
export function instantQuoteProbeResult(): boolean | null {
  return cached === null ? null : cached.quote;
}

/** Takım bayrağının bilinen cevabı; henüz sorulmadıysa `null`. */
export function quoteTeamsProbeResult(): boolean | null {
  return cached === null ? null : cached.teams;
}

/**
 * Bayrakları sorar. Cevap bir kez alınır ve paylaşılır.
 *
 * Hata (ağ kopukluğu, 5xx) "kapalı" DEĞİL "bilinmiyor" sayılır: o çağrıya
 * `false` döner — yani müşteri eski, çalışan akışta kalır — ama önbelleğe
 * yazılmaz, bir sonraki mount yeniden sorar. Tersi olsaydı tek bir kopuk
 * istek, bayrak açık olmasına rağmen sayfayı yenileyene kadar müşteriyi eski
 * akışa hapsederdi.
 */
function probeQuoteFlags(): Promise<QuoteFlagProbe> {
  if (cached !== null) return Promise.resolve(cached);
  if (!inFlight) {
    inFlight = fetchQuoteCatalog()
      .then((body) => {
        // Kesin eşitlik: gövde beklenmedik bir şey döndürdüyse (boş cevap,
        // vekil sunucu sayfası) özellik AÇILMAZ.
        const raw = body as { enabled?: unknown; teamsEnabled?: unknown } | null;
        const result: QuoteFlagProbe = {
          quote: raw?.enabled === true,
          teams: raw?.teamsEnabled === true,
        };
        cached = result;
        return result;
      })
      .catch(() => UNKNOWN)
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** `instant_quote_enabled` — teklif yüzeyleri açık mı. */
export function probeInstantQuoteEnabled(): Promise<boolean> {
  return probeQuoteFlags().then((flags) => flags.quote);
}

/** `quote_teams_enabled` — takım yüzeyleri açık mı. */
export function probeQuoteTeamsEnabled(): Promise<boolean> {
  return probeQuoteFlags().then((flags) => flags.teams);
}

/** Testler için: sondayı hiç sorulmamış hâline döndürür. */
export function resetInstantQuoteProbe(): void {
  cached = null;
  inFlight = null;
}

/**
 * Bayrağın durumu: `null` = cevap henüz gelmedi.
 *
 * Çağıran `null`'ı "kapalı" gibi ele alır (eski, çalışan davranış); böylece
 * cevap gecikirse ekranda boşluk değil eski hâl durur.
 *
 * İKİ KANCA AYNI SONDAYI PAYLAŞIR: alan ADI parametredir, istek tek kalır.
 * Kancalar yine ayrı çünkü çağıranları ayrı — bir bileşenin iki bayrağı
 * birden sorması gerekmiyor.
 *
 * Cevap SONDANIN DÖNÜŞÜNDEN okunur, önbellekten değil: hata hâlinde önbellek
 * BOŞ kalır (yukarıdaki gerekçe) ve önbelleği okuyan bir efekt `null` görüp
 * kendini sonsuza kadar yeniden kurardı.
 */
function useQuoteFlag(key: keyof QuoteFlagProbe): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(() =>
    cached === null ? null : cached[key]
  );

  useEffect(() => {
    if (enabled !== null) return;
    let cancelled = false;
    void probeQuoteFlags().then((flags) => {
      if (!cancelled) setEnabled(flags[key]);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, key]);

  return enabled;
}

export function useInstantQuoteEnabled(): boolean | null {
  return useQuoteFlag("quote");
}

export function useQuoteTeamsEnabled(): boolean | null {
  return useQuoteFlag("teams");
}
