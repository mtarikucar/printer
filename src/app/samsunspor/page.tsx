import type { Metadata, Viewport } from "next";
import { Big_Shoulders } from "next/font/google";
import { StageClient } from "./stage-client";
import { SAMSUNSPOR_VIDEO } from "./video-manifest";

/**
 * /samsunspor — tek ekranlık kampanya sahnesi.
 *
 * Sayfa KAYDIRILMAZ: sahne `position: fixed; inset: 0` ile görünüm alanına
 * çivilenir, kök layout'un footer'ı ve WhatsApp düğmesi bu yolda kendini
 * gizler (bkz. site-footer.tsx, whatsapp-fab.tsx). Aksi halde footer sahnenin
 * altına düşer ve sayfayı kaydırılabilir yapardı.
 *
 * Videoyu değiştirmek için dosyalara elle dokunulmaz:
 *   node scripts/samsunspor-video.mjs "kaynak.mp4"
 * Komut çözünürlükleri, posteri ve `video-manifest.ts` listesini üretir.
 */

// latin-ext: "ŞİMŞEKLER" içindeki Ş ve İ aynı yazı yüzünden gelsin, kelimenin
// ortasında yedek fonta düşmesin.
const display = Big_Shoulders({
  subsets: ["latin", "latin-ext"],
  weight: ["700", "900"],
  variable: "--font-tribune",
  display: "swap",
  // Bu yazı yüzü için hazır yedek ölçüsü yok; aramayı kapatmak derleme
  // uyarısını susturur. Yedek zinciri CSS tarafında elle verildi.
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: "Kırmızı Şimşekler'in Kalkanı | Figurunica",
  description:
    "Kırmızı beyaz kalkanını yerden alan figür. Samsun'un renkleriyle, el boyaması kişiye özel figürler Figurunica'da.",
  openGraph: {
    title: "Kırmızı Şimşekler'in Kalkanı | Figurunica",
    description:
      "Kırmızı beyaz kalkanını yerden alan figür. Samsun'un renkleriyle, el boyaması kişiye özel figürler.",
    images: [{ url: "/samsunspor/og.jpg", width: 1200, height: 630 }],
  },
};

export const viewport: Viewport = {
  // Tarayıcı çubuğu sahneyle aynı gece kırmızısına bürünsün.
  themeColor: "#12060A",
  // Çentikli telefonlarda sahne kenardan kenara uzansın; iç boşlukları
  // env(safe-area-inset-*) ile CSS tarafı verir.
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function SamsunsporPage() {
  return (
    <StageClient
      renditions={SAMSUNSPOR_VIDEO.renditions}
      aspect={SAMSUNSPOR_VIDEO.aspect}
      posterSrc={SAMSUNSPOR_VIDEO.poster}
      fontClassName={display.variable}
    />
  );
}
