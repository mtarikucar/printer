import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { cancelWorkshopSession } from "@/lib/services/workshop-cancel";

/**
 * Seansı iptal eder ve ödemiş katılımcıların parasını iade eder.
 *
 * Mantık `workshop-cancel.ts`tedir (aynı gerekçeyle `refundOrder` da rotadan
 * çıkarıldı): iade TEK para yolundan geçer ve testten geçirilebilir.
 *
 * `delivered`/`completed` seans REDDEDİLİR (409): parti mekana ulaşmış ve
 * hakediş tahakkuk etmiştir; o satırı `cancelled` yapmak hiçbir parayı geri
 * getirmez, yalnızca olan biteni yalanlar. Buton da gizlidir; kapı burada da
 * durur ki doğrudan bir POST arayüzle ayrışmasın.
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
    // Makine okunur kod; Türkçesini istemci kurar (katılımcı ucuyla AYNI
    // sözleşme — iki uç arasında iki farklı hata biçimi tutmak, istemcide iki
    // farklı işleme yolu demektir).
    return NextResponse.json(
      { error: res.reason },
      { status: res.reason === "not_found" ? 404 : 409 }
    );
  }

  return NextResponse.json({ ok: true, ...res.report });
}
