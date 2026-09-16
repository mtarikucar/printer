import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { assignBatchManufacturerSchema } from "@/lib/validators/workshop";
import { assignBatchManufacturer } from "@/lib/services/workshop-session";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

/**
 * Üreticisiz kapanmış bir seansın partisini topluca bir üreticiye devreder.
 *
 * Bu uç, `notifyAdminSessionWithoutManufacturer` e-postasının "seansa bir
 * üretici atayın ve siparişleri elle üreticiye verin" cümlesinin karşılığıdır.
 * O cümle aylarca hiçbir arayüzü olmayan bir eylemi tarif ediyordu: seans
 * `closed`da kilitli kalıyor, PATCH ile `open`a çekilemiyor (fiyatlanmış),
 * öksüz sahiplenme onu atlıyor ve toplu sevk sipariş başına üretici arıyordu.
 *
 * Mantık `workshop-session.ts`te (`assignBatchManufacturer`): atama alanları
 * `batchAssignmentSet` ile — kapanış ve öksüz sahiplenme ile AYNI tanımla —
 * yazılır. Rota yalnızca yetki + HTTP eşlemesi yapar. Hata metinleri Türkçe ve
 * doğrudan admin'e gösterilebilir.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const { id } = await params;
    const parsed = assignBatchManufacturerSchema.safeParse(
      await request.json().catch(() => ({}))
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Geçersiz istek" },
        { status: 400 }
      );
    }

    const res = await assignBatchManufacturer({
      sessionId: id,
      manufacturerId: parsed.data.manufacturerId,
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: res.error },
        { status: res.error === "Seans bulunamadı" ? 404 : 409 }
      );
    }

    return NextResponse.json({
      ok: true,
      orderCount: res.orderCount,
      commissionRateBps: res.commissionRateBps,
    });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/workshops/sessions/[id]/assign-manufacturer", ADMIN_ACTION_FAILED_ERROR);
  }
}
