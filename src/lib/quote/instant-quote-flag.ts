"use client";

/**
 * `instant_quote_enabled` bayrağının TARAYICI tarafındaki tek sondası.
 *
 * Bayrak sunucuda yaşar (admin `/admin/ayarlar`'dan çevirir) ve ÇALIŞMA
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
 * Sunucuda (SSR/RSC) önbellek HİÇ dolmaz — sondayı yalnız `useEffect`
 * çalıştırır, efekt de yalnız tarayıcıda çalışır. Bu yüzden ilk HTML her zaman
 * "bilinmiyor" hâliyle üretilir ve hidrasyon uyuşmazlığı doğmaz.
 */
import { useEffect, useState } from "react";
import { fetchQuoteCatalog } from "@/lib/quote/client-api";

let cached: boolean | null = null;
let inFlight: Promise<boolean> | null = null;

/** Sondanın bilinen cevabı; henüz sorulmadıysa `null`. */
export function instantQuoteProbeResult(): boolean | null {
  return cached;
}

/**
 * Bayrağı sorar. Cevap bir kez alınır ve paylaşılır.
 *
 * Hata (ağ kopukluğu, 5xx) "kapalı" DEĞİL "bilinmiyor" sayılır: o çağrıya
 * `false` döner — yani müşteri eski, çalışan akışta kalır — ama önbelleğe
 * yazılmaz, bir sonraki mount yeniden sorar. Tersi olsaydı tek bir kopuk
 * istek, bayrak açık olmasına rağmen sayfayı yenileyene kadar müşteriyi eski
 * akışa hapsederdi.
 */
export function probeInstantQuoteEnabled(): Promise<boolean> {
  if (cached !== null) return Promise.resolve(cached);
  if (!inFlight) {
    inFlight = fetchQuoteCatalog()
      .then((body) => {
        // Kesin eşitlik: gövde beklenmedik bir şey döndürdüyse (boş cevap,
        // vekil sunucu sayfası) özellik AÇILMAZ.
        const enabled = (body as { enabled?: unknown } | null)?.enabled === true;
        cached = enabled;
        return enabled;
      })
      .catch(() => false)
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
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
 */
export function useInstantQuoteEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(instantQuoteProbeResult);

  useEffect(() => {
    if (enabled !== null) return;
    let cancelled = false;
    probeInstantQuoteEnabled().then((value) => {
      if (!cancelled) setEnabled(value);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return enabled;
}
