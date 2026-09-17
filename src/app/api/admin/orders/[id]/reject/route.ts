import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { cancelPaidOrder, readOrderRefundView } from "@/lib/services/order-refund-record";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const { id } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return NextResponse.json({ error: "Sipariş bulunamadı." }, { status: 404 });
    }
    const body = await request.json().catch(() => ({}));
    if (!body || typeof body.operationKey !== "string" || typeof body.expectedFingerprint !== "string") {
      return NextResponse.json({ error: "Güncel sipariş kaydını açıp tekrar deneyin." }, { status: 400 });
    }
    const d = getDictionary(getRequestLocale(request));
    const reason = typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim() : d["api.order.rejectedDefault"];
    // source enforces REJECTABLE_STATUSES under the backend's order lock.
    // Audit, notes, detach, pending reversal and any provable gift return all
    // commit there. Rejection does not attest to an actual cash refund.
    const result = await cancelPaidOrder({
      orderId: id,
      operationKey: body.operationKey,
      expectedFingerprint: body.expectedFingerprint,
      source: "admin_reject",
      reason: reason.length < 10 ? `Sipariş reddedildi: ${reason}` : reason,
      notes: typeof body.notes === "string" ? body.notes.trim() : undefined,
    }, { adminEmail: a.session.user.email });
    if (!result.ok) return NextResponse.json(result, { status: result.status });
    // Replays must expose today's obligations, not the original result delta.
    try {
      const current = await readOrderRefundView(id);
      const outstanding = current.siblings.find(row => row.orderId === id);
      if (!outstanding) throw new Error("Cancelled order missing from refund view");
      return NextResponse.json({ success: true, ...result,
        cashRefundRequiredKurus: outstanding.remainingCashKurus,
        giftRefundRequiredKurus: outstanding.remainingGiftKurus,
        legacyUnverified: outstanding.legacyUnverified,
      });
    } catch (error) {
      console.error("reject committed; outstanding obligations unavailable", error);
      return NextResponse.json({ success: true, ...result,
        cashRefundRequiredKurus: null, giftRefundRequiredKurus: null,
        warning: "Sipariş iptal edildi. Güncel iade yükümlülükleri okunamadı; sipariş kaydını yenileyin.",
      });
    }
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/orders/[id]/reject", ADMIN_ACTION_FAILED_ERROR);
  }
}
