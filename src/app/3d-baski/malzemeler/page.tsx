import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { loadLandingSnapshot } from "../catalog";
import { MaterialLibrary } from "../sections";

/**
 * `/3d-baski/malzemeler` — malzeme kütüphanesi.
 *
 * Açılış sayfasındaki malzeme kartlarının hedefi. Burada BAYRAK KAPISI YOK:
 * sayfa bir ürün yüzeyi değil, katalogdan üretilen teknik bir referans; yükleme
 * ya da fiyat isteyen hiçbir eylemi yok. Bayrak kapalıyken de doğru bilgiyi
 * verir ve arama motorunun okuduğu yüzey kesintiye uğramaz.
 */
export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const snapshot = await loadLandingSnapshot();
  const names = snapshot.materials.map((m) => m.name).join(", ");
  return {
    title: "3D Baskı Malzemeleri — Teknik Özellikler",
    description:
      `FDM ve SLA baskı malzemeleri: ${names}. Çekme dayanımı, ısı dayanımı, yoğunluk, ` +
      "renk seçenekleri ve başlangıç fiyatlarıyla.",
  };
}

export default async function MaterialsPage() {
  const snapshot = await loadLandingSnapshot();

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <MaterialLibrary snapshot={snapshot} />
    </main>
  );
}
