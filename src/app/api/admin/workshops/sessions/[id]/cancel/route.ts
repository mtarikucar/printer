import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { cancelWorkshopSession } from "@/lib/services/workshop-cancel";

/**
 * Seansı iptal eder ve ödemiş katılımcıların parasını iade eder.
 *
 * Mantık `workshop-cancel.ts`tedir (aynı gerekçeyle `refundOrder` da rotadan
 * çıkarıldı): iade TEK para yolundan geçer ve testten geçirilebilir.
 *
 * İDEMPOTENT — zaten `cancelled` bir seansta da çalışır ve yalnızca iadesi
 * geçen sefer patlayanları yeniden dener. Yanıttaki `failed` ve
 * `alreadyShipped` admin ekranında UYARI olarak gösterilir: sessizce yutulan
 * bir iade, geri ödenmemiş müşteri parası demektir.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;

  const { id } = await params;
  const res = await cancelWorkshopSession({
    sessionId: id,
    adminEmail: a.session.user.email,
  });
  if (!res.ok) {
    return NextResponse.json({ error: "Seans bulunamadı" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, ...res.report });
}
