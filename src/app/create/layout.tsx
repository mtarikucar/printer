import type { Metadata } from "next";

/**
 * Metadata lives in a layout because `page.tsx` here is a client component and
 * client components cannot export `metadata`. Without this the page inherited
 * the site-wide title, so every result looked identical in search and in an AI
 * answer's citation list.
 */
export const metadata: Metadata = {
  title: "Kendi Figürünü Oluştur",
  description: "Fotoğrafını yükle, yapay zeka figür tasarımını çıkarsın. 15 cm SLA reçine baskı, profesyonel el boyaması, ücretsiz kargo.",
  openGraph: {
    title: "Kendi Figürünü Oluştur",
    description: "Fotoğrafını yükle, yapay zeka figür tasarımını çıkarsın. 15 cm SLA reçine baskı, profesyonel el boyaması, ücretsiz kargo.",
    type: "website",
    // Root'un openGraph'ı bir alt layout tarafından TAMAMEN değiştiriliyor,
    // miras alınmıyor. Görsel burada açıkça verilmezse opengraph-image.tsx'in
    // ürettiği kart bu sayfalarda kayboluyor — ve bunlar linki en çok
    // paylaşılan iki sayfa.
    images: ["/opengraph-image"],
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
