import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import {
  loadManufacturerCapacities,
  emptyManufacturerCapacity,
  manufacturerLoadLabel,
} from "@/lib/services/manufacturer-capacity";
import { handleRouteFailure, ADMIN_READ_FAILED_ERROR } from "@/lib/api/route-error";

export async function GET(_request: NextRequest) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const allManufacturers = await db.query.manufacturers.findMany({
      orderBy: (m, { desc }) => [desc(m.createdAt)],
    });

    // KAPASİTE, ORTAK ÖLÇÜDEN (services/manufacturer-capacity.ts). Burada kendi
    // count(*) sayımımız duruyordu ve İKİ yönden birden yalan söylüyordu:
    //  • iade edilmiş iş düşülmüyordu — iade siparişin durumunu KORUDUĞU için
    //    o satır tezgâhta duruyormuş gibi görünüyor, atölye var olmayan bir iş
    //    yüzünden dolu sayılıyordu;
    //  • ölçü ham İŞ SAYISIYDI: 300 adetlik bir toplu sipariş tek slot işgal
    //    ediyordu, yani ekran "1/5" derken atölyenin tezgâhı çoktan dolmuştu.
    // Artık ekran ile atama kapısı AYNI fonksiyonu okur; birinin kapattığını
    // öteki kabul edemez.
    const capacities = await loadManufacturerCapacities(
      allManufacturers.map((m) => m.id)
    );

    const result = allManufacturers.map((m) => {
      // Eksik anahtar "bilinmiyor" değil "boş tezgâh" demektir.
      const cap =
        capacities.get(m.id) ??
        emptyManufacturerCapacity(m.id, m.maxConcurrentOrders);
      return {
        id: m.id,
        email: m.email,
        companyName: m.companyName,
        contactPerson: m.contactPerson,
        phone: m.phone,
        taxId: m.taxId,
        taxIdType: m.taxIdType,
        requiresManualTaxReview: m.requiresManualTaxReview,
        status: m.status,
        // GÖSTERİM: tezgâhtaki ayrı kutu sayısı. Alan adı korunuyor (dış
        // tüketiciler bunu okuyor) ama artık KAPI DEĞİL.
        activeOrderCount: cap.activeJobs,
        // KAPI: ağırlıklı yük ve onun tek boolean cevabı.
        loadUnits: cap.loadUnits,
        maxConcurrentOrders: cap.maxConcurrentOrders,
        hasRoom: cap.hasRoom,
        // Tek yük etiketi: "2/5 birim · 1 iş".
        loadLabel: manufacturerLoadLabel(cap),
        createdAt: m.createdAt,
      };
    });

    return NextResponse.json({ manufacturers: result });
  } catch (e) {
    return handleRouteFailure(e, "GET /api/admin/manufacturers", ADMIN_READ_FAILED_ERROR);
  }
}
