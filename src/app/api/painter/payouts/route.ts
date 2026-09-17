import { NextRequest, NextResponse } from "next/server";
import { getPainterSession } from "@/lib/services/painter-auth";
import { parsePayoutListRequest, PayoutListInputError } from "@/lib/config/payout-list";
import { readPayoutPage } from "@/lib/services/payout-list";
import { handleRouteFailure, PARTNER_READ_FAILED_ERROR } from "@/lib/api/route-error";

export async function GET(request: NextRequest) {
  try {
    const session = await getPainterSession();
    if (!session) return NextResponse.json({ error: "Ödeme geçmişi için oturum açın." }, { status: 401 });
    const { scope, query } = parsePayoutListRequest(request.nextUrl.searchParams, { audience: "partner", kind: "painter", partnerId: session.painterId });
    return NextResponse.json(await readPayoutPage(scope, query), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof PayoutListInputError) return NextResponse.json({ error: `Ödeme geçmişi filtresi geçersiz: ${error.message}`, code: error.code }, { status: 400 });
    return handleRouteFailure(error, "GET /api/painter/payouts", PARTNER_READ_FAILED_ERROR);
  }
}
