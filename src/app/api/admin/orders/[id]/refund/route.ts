import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { readOrderRefundView, recordOrderRefund } from "@/lib/services/order-refund-record";
import { normalizeRecordRefundInput, RefundPolicyError } from "@/lib/config/order-refund";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR, ADMIN_READ_FAILED_ERROR } from "@/lib/api/route-error";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "Sipariş bulunamadı." }, { status: 404 });
    return NextResponse.json(await readOrderRefundView(id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RefundPolicyError) return NextResponse.json({ error: `İade kayıtları okunamadı: ${error.message}`, code: error.code }, { status: error.status });
    return handleRouteFailure(error, "GET /api/admin/orders/[id]/refund", ADMIN_READ_FAILED_ERROR);
  }
}

/** Records an already completed external cash return; never initiates a transfer. */
export async function POST(request: NextRequest, { params }: Context) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "Sipariş bulunamadı." }, { status: 404 });
    const input = normalizeRecordRefundInput(await request.json().catch(() => null));
    if (!input.allocations.some(row => row.orderId === id.toLowerCase())) return NextResponse.json({ error: "Açık sipariş, iade dağılımında yer almalıdır." }, { status: 400 });
    const result = await recordOrderRefund(input, { adminEmail: a.session.user.email });
    return NextResponse.json(result, { status: result.ok ? 200 : result.status });
  } catch (error) {
    if (error instanceof RefundPolicyError) return NextResponse.json({ error: `İade kaydedilemedi: ${error.message}`, code: error.code }, { status: error.status });
    return handleRouteFailure(error, "POST /api/admin/orders/[id]/refund", ADMIN_ACTION_FAILED_ERROR);
  }
}
