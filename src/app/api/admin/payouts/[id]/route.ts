import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

// Even an empty batch is financial history. Legacy clients must use the audited
// pending-only void endpoint with a current fingerprint and a reason.
export async function DELETE() {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    return NextResponse.json({ error: "Ödeme geçmişi silinemez. Bekleyen partiyi güncel bilgiler ve gerekçe ile İptal et işlemini kullanarak iptal edin.", code: "payout_void_required" }, { status: 409 });
  } catch (error) {
    return handleRouteFailure(error, "DELETE /api/admin/payouts/[id]", ADMIN_ACTION_FAILED_ERROR);
  }
}
