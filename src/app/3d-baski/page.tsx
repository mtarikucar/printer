import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { LastUpdated } from "@/components/last-updated";
import { JsonLd } from "@/lib/seo/jsonld";
import { buildPrintServiceJsonLd } from "@/lib/seo/service";
import { isFlagEnabled } from "@/lib/services/flags";
import { isAdminSession } from "@/lib/services/quote-access";
import { quoteAcceptedFormats } from "@/lib/services/quote-present";
import { loadLandingSnapshot } from "./catalog";
import { LandingUploader } from "./landing-uploader";
import { anchorSentence, formatAnchorPrice, technologyAnchorKurus } from "./pricing-anchors";
import { ComingSoonNote, PrintServiceLanding } from "./sections";

/**
 * `/3d-baski` — anlık teklif motorunun halka açık yüzü.
 *
 * Bu sayfa projenin TEK indekslenen fiyat yüzeyidir (çalışma alanı noindex,
 * fiyatlar giriş kapısının arkasında). Bu yüzden başlık, açıklama ve gövde
 * katalogdan hesaplanan gerçek rakamlarla yazılır: rakamsız bir hizmet
 * sayfası ne müşteriye karar verdirir ne de alıntılanır.
 *
 * Bayrak kapalıyken (ve ziyaretçi admin değilken) yükleyicinin yerini
 * "Yakında" kutusu alır; sayfanın geri kalanı — teknoloji tablosu, malzemeler,
 * SSS — durur. Bayrak bir ÜRÜN kapısıdır, içerik kapısı değil.
 */
export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const snapshot = await loadLandingSnapshot();
  const anchors = snapshot.technologies
    .flatMap((tech) => {
      const kurus = technologyAnchorKurus(snapshot, tech.key);
      return kurus === null ? [] : [`${tech.name} ${anchorSentence(kurus)}`];
    })
    .join(", ");

  return {
    title: "3D Baskı Servisi — Anlık Teklif",
    description:
      // STEP burada ANILMAZ: bu metin bayrak OKUMUYOR (metadata üretimi katalog
      // anlık görüntüsünü alıyor, bayrağı değil), yani `quote_step_enabled`
      // kapalıyken STEP'ten söz etmek yükleyicinin reddettiği bir şeyi vaat
      // etmek olur. Bayrak açıldığı turda bu satır ve `sections.tsx`in STEP
      // metinleri birlikte geri gelir — ya da daha iyisi, ikisi de bayrağı
      // okuyacak hâle getirilir (bkz. kayıt defteri, B3).
      `STL, OBJ veya 3MF dosyanızı yükleyin, fiyatı anında görün. ${anchors}` +
      " (20 mm küp, 1 adet, KDV dahil; asgari sipariş" +
      ` ${formatAnchorPrice(snapshot.settings.minOrderKurus)}). Tek teklifte` +
      ` ${snapshot.settings.maxPartsPerQuote} parçaya kadar; Türkiye içi kargo ücretsiz.`,
  };
}

export default async function PrintServicePage() {
  const [snapshot, flagEnabled, stepFlagEnabled] = await Promise.all([
    loadLandingSnapshot(),
    isFlagEnabled("instant_quote_enabled"),
    isFlagEnabled("quote_step_enabled"),
  ]);
  // Admin oturumu yalnız bayrak KAPALIYKEN sorulur: açıkken hiçbir çerez
  // okunmaz ve sayfa gerçekten statik olarak (revalidate 3600) üretilebilir.
  // Bu yüzden STEP kapısı da AYNI okumayı paylaşır — ikinci bir çerez okuması
  // eklemek, motor açıkken sayfayı her istekte dinamik yapardı.
  const adminSession = flagEnabled ? false : await isAdminSession();
  const uploaderVisible = flagEnabled || adminSession;
  // Müşteriye NE seçtirileceği (dropzone `accept` + istemci doğrulaması).
  // Liste teklif kataloğuyla AYNI işlevden gelir: ayrışırsa bu sayfa müşteriye
  // `.step` seçtirip uç 400 verirdi. Bayrak kapalı + admin oturumu = iç test
  // hâli (`stepUploadsEnabled` ile aynı kural); sıradan ziyaretçi `.step`i hiç
  // göremez.
  const acceptedFormats = quoteAcceptedFormats(stepFlagEnabled || adminSession);

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      {/* Yapısal veri hizmet GERÇEKTEN sipariş alınabilir durumdayken
          yayımlanır: "Yakında" diyen bir sayfaya Offer iliştirmek, arama
          motoruna satın alınabilir bir hizmet olduğunu söylemek olurdu. */}
      {flagEnabled ? <JsonLd data={buildPrintServiceJsonLd(snapshot)} /> : null}
      <PrintServiceLanding
        snapshot={snapshot}
        uploader={
          uploaderVisible ? (
            <LandingUploader
              maxFileBytes={snapshot.settings.maxFileBytes}
              maxPartsPerQuote={snapshot.settings.maxPartsPerQuote}
              acceptedFormats={acceptedFormats}
            />
          ) : (
            <ComingSoonNote />
          )
        }
      />
      {/* `locale` BİLEREK geçilmiyor: yukarıdaki gerekçeyle bu sayfa bayrak
          açıkken HİÇ çerez okumamalı (statik üretilebilirliğinin tek koşulu),
          `getLocale()` ise bir çerez okumasıdır. */}
      <LastUpdated path="/3d-baski" />
    </main>
  );
}
