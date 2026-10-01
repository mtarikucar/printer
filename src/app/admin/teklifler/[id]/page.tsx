export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { frameworkScreensEnabled } from "@/lib/services/quote-access";
import { loadAdminQuoteDetail } from "@/lib/services/quote-admin";
import { loadFrameworkEntry, type FrameworkEntryGate } from "@/lib/services/quote-framework";
import { QuoteDetailClient } from "./client";

/**
 * `/admin/teklifler/[id]` — tek teklifin karar ekranı.
 *
 * Teklifin KENDİSİ sayfanın çekirdek verisidir: okunamazsa gösterilecek bir
 * şey de yoktur, bu yüzden bu okuma korumasızdır (ev kuralı: `CORE_READS`).
 * Kuyruğa dönüş ve kenar çubuğu rozeti düzenin işidir ve onlar korumalıdır.
 *
 * ─── ÇERÇEVE GİRİŞ NOKTASI ─────────────────────────────────────────────────
 *
 * "Çerçeve anlaşmaya dönüştür" düğmesi BAYRAK KAPALIYKEN HİÇ RENDER EDİLMEZ:
 * `frameworkEntry` `null` iner ve ekranda çerçeveye dair tek kelime geçmez
 * (kapalı bir özelliğin varlığını duyurmanın anlamı yok). Kapı
 * `frameworkScreensEnabled` — YALNIZ bayrak. `frameworkSurfacesEnabled`
 * olamaz: o, admin oturumunu iç test için geçiriyor ve bu sayfaya yalnız
 * admin girebildiği için bayrak kapalıyken de kart çizilir, hatta anlaşma
 * KURULABİLİRDİ (§F3.4 bunun tersini söylüyor).
 *
 * Bayrak açıkken kapı UÇTAKİYLE AYNI kaynaktan gelir (`loadFrameworkEntry` →
 * `entryRefusals` + `validateFrameworkAgreement`): ekran ucun reddettiği bir
 * düğme göstermez ve ucun kabul ettiği bir teklifte düğmeyi saklamaz. Kapı
 * GÖSTERİM okumasıdır — düşerse sayfa çökmez, düğme çizilmez ve sebebi yazılır.
 */
export default async function AdminQuoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await loadAdminQuoteDetail(id);
  if (!detail) notFound();

  let frameworkEntry: FrameworkEntryGate | null = null;
  let frameworkEntryUnreadable = false;
  if (await frameworkScreensEnabled()) {
    frameworkEntry = await loadFrameworkEntry(detail.id).catch((e) => {
      console.error(`[admin/teklifler ${detail.id}] çerçeve giriş kapısı okunamadı`, e);
      frameworkEntryUnreadable = true;
      return null;
    });
  }

  return (
    <QuoteDetailClient
      quote={detail}
      frameworkEntry={frameworkEntry}
      frameworkEntryUnreadable={frameworkEntryUnreadable}
    />
  );
}
