import { NextRequest, NextResponse } from "next/server";
import { getPainterSession } from "@/lib/services/painter-auth";
import { exportPayoutRequest } from "@/lib/services/payout-export";
import { PayoutListInputError } from "@/lib/config/payout-list";
import { handleRouteFailure, PARTNER_READ_FAILED_ERROR } from "@/lib/api/route-error";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const session = await getPainterSession();
    if (!session) return NextResponse.json({ error: "Ödeme geçmişini indirmek için oturum açın." }, { status: 401 });
    return await exportPayoutRequest(request.nextUrl.searchParams, { audience: "partner", kind: "painter", partnerId: session.painterId }, request.signal);
  } catch (error) {
    if (error instanceof PayoutListInputError) return NextResponse.json({ error: `CSV filtreleri geçersiz: ${error.message}` }, { status: 400 });
    return handleRouteFailure(error, "GET /api/painter/payouts/export", PARTNER_READ_FAILED_ERROR);
  }
}
