import type { Metadata } from "next";

/**
 * Metadata lives in a layout because `page.tsx` here is a client component and
 * client components cannot export `metadata`. Without this the page inherited
 * the site-wide title, so every result looked identical in search and in an AI
 * answer's citation list.
 */
export const metadata: Metadata = {
  title: "Hazır Ürünler — Anahtarlık, Magnet, Lamba",
  description: "Fotoğrafından anahtarlık, buzdolabı magneti veya gece lambası. Sabit fiyat, hızlı üretim, Türkiye'ye ücretsiz kargo.",
  alternates: { canonical: "https://figurunica.com/urunler" },
  openGraph: {
    title: "Hazır Ürünler — Anahtarlık, Magnet, Lamba",
    description: "Fotoğrafından anahtarlık, buzdolabı magneti veya gece lambası. Sabit fiyat, hızlı üretim, Türkiye'ye ücretsiz kargo.",
    url: "https://figurunica.com/urunler",
    type: "website",
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
