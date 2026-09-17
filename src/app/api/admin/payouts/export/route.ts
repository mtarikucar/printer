import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { exportPayoutRequest } from "@/lib/services/payout-export";
import { PayoutListInputError } from "@/lib/config/payout-list";
import { handleRouteFailure, ADMIN_READ_FAILED_ERROR } from "@/lib/api/route-error";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    return await exportPayoutRequest(request.nextUrl.searchParams, { audience: "admin" }, request.signal);
  } catch (error) {
    if (error instanceof PayoutListInputError) return NextResponse.json({ error: `CSV filtreleri geçersiz: ${error.message}` }, { status: 400 });
    return handleRouteFailure(error, "GET /api/admin/payouts/export", ADMIN_READ_FAILED_ERROR);
  }
}
