import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import {
  emptyPainterCapacity,
  loadPainterCapacities,
  painterLoadLabel,
} from "@/lib/services/painter-capacity";
import { handleRouteFailure, ADMIN_READ_FAILED_ERROR } from "@/lib/api/route-error";

export async function GET(_request: NextRequest) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const allPainters = await db.query.painters.findMany({
      orderBy: (p, { desc }) => [desc(p.createdAt)],
    });

    // KAPASİTE TEK ÖLÇÜDEN OKUNUR (services/painter-capacity.ts).
    //
    // Burada kendi `count(*)` sayımımız duruyordu ve İADE EDİLMİŞ işi de
    // sayıyordu: tek işi iade edilmiş bir boyacı bu uçta "1 aktif iş",
    // sipariş kartında ise "0/1" okunuyordu — admin, hangi ekrana baktığına
    // göre aynı boyacıyı dolu ya da boş görüyordu. İade edilmiş sipariş
    // kimsenin kapasitesini tüketmez; bu kural artık tek yerde duruyor.
    const caps = await loadPainterCapacities(allPainters.map((p) => p.id));

    const result = allPainters.map((p) => {
      // Satır her boyacı için gelir; yine de `??` duruyor, çünkü eksik anahtar
      // "yük bilinmiyor" değil "boş tezgâh" demektir ve bunu tahmine bırakmak
      // ekranda sıfırla dolu arasında sessiz bir fark yaratırdı.
      const cap = caps.get(p.id) ?? emptyPainterCapacity(p.id, p.maxConcurrentOrders);
      return {
        id: p.id,
        email: p.email,
        companyName: p.companyName,
        contactPerson: p.contactPerson,
        phone: p.phone,
        taxId: p.taxId,
        taxIdType: p.taxIdType,
        requiresManualTaxReview: p.requiresManualTaxReview,
        status: p.status,
        workSamplePhotoUploadedAt: p.workSamplePhotoUploadedAt,
        // GÖSTERİM: tezgâhtaki ayrı iş (kutu) sayısı. KAPI DEĞİL.
        activeOrderCount: cap.activeJobs,
        // KAPI: yeni iş düşüp düşmeyeceğini belirleyen AĞIRLIKLI yük. Uçların
        // uyguladığı ölçü budur, bu yüzden ekrana da bu gider.
        loadUnits: cap.loadUnits,
        maxConcurrentOrders: cap.maxConcurrentOrders,
        hasRoom: cap.hasRoom,
        // Tek yük etiketi ("4/5 birim · 1 iş"): iki admin ekranı aynı boyacı
        // için farklı cümle yazmasın diye tek kaynaktan gelir.
        loadLabel: painterLoadLabel(cap),
        createdAt: p.createdAt,
      };
    });

    return NextResponse.json({ painters: result });
  } catch (e) {
    return handleRouteFailure(e, "GET /api/admin/painters", ADMIN_READ_FAILED_ERROR);
  }
}
