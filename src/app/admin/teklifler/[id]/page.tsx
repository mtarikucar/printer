export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { loadAdminQuoteDetail } from "@/lib/services/quote-admin";
import { QuoteDetailClient } from "./client";

/**
 * `/admin/teklifler/[id]` — tek teklifin karar ekranı.
 *
 * Teklifin KENDİSİ sayfanın çekirdek verisidir: okunamazsa gösterilecek bir
 * şey de yoktur, bu yüzden bu okuma korumasızdır (ev kuralı: `CORE_READS`).
 * Kuyruğa dönüş ve kenar çubuğu rozeti düzenin işidir ve onlar korumalıdır.
 */
export default async function AdminQuoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await loadAdminQuoteDetail(id);
  if (!detail) notFound();

  return <QuoteDetailClient quote={detail} />;
}
