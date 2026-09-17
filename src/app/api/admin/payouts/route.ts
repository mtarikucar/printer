import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { parsePayoutListRequest, PayoutListInputError } from "@/lib/config/payout-list";
import { readPayoutPage } from "@/lib/services/payout-list";
import { handleRouteFailure, ADMIN_READ_FAILED_ERROR } from "@/lib/api/route-error";

export async function GET(request: NextRequest) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const { scope, query } = parsePayoutListRequest(request.nextUrl.searchParams, { audience: "admin" });
    return NextResponse.json(await readPayoutPage(scope, query), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof PayoutListInputError) return NextResponse.json({ error: `Ödeme geçmişi filtresi geçersiz: ${error.message}`, code: error.code }, { status: 400 });
    return handleRouteFailure(error, "GET /api/admin/payouts", ADMIN_READ_FAILED_ERROR);
  }
}
