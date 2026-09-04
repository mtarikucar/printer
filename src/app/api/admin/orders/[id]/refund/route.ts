import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { refundOrder } from "@/lib/services/order-refund";

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
  const a = await requireAdmin();
  if ("response" in a) return a.response;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : null;

  const r = await refundOrder({ orderId: id, reason, adminEmail: a.session.user.email });
  if (!r.ok) {
    return NextResponse.json(
      { error: r.reason },
      { status: r.reason === "not_found" ? 404 : 400 }
    );
  }
  return NextResponse.json({ ok: true });
}
