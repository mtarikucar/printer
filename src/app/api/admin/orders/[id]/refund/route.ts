import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { refundOrder } from "@/lib/services/order-refund";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

// Faz 7: mark an order refunded. Flips paymentStatus, reverses any manufacturer
// earning, records the admin action, and notifies the customer (in-app + email).
//
// Bütün mantık `refundOrder` servisindedir: atölye seansı/katılımcısı iptal
// edildiğinde de AYNI para yolu çalışır. Rota yalnızca yetki + gövde ayrıştırma
// + HTTP eşlemesi yapar.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : null;

    const r = await refundOrder({ orderId: id, reason, adminEmail: a.session.user.email });
    if (!r.ok) {
      // The admin page alerts `error` as-is, so it is Turkish copy, not a key.
      // `already_refunded` also covers losing a race: the service's guarded
      // UPDATE matched no row because a reject or another refund got there
      // first, and none of the refund side effects ran a second time.
      return r.reason === "already_refunded"
        ? NextResponse.json({ error: "Sipariş zaten iade edilmiş." }, { status: 409 })
        : NextResponse.json({ error: "Sipariş bulunamadı." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/orders/[id]/refund", ADMIN_ACTION_FAILED_ERROR);
  }
}
