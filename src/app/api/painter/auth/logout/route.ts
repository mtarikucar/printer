import { NextResponse } from "next/server";
import { clearPainterSessionCookie } from "@/lib/services/painter-auth";
import { handleRouteFailure, PARTNER_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

export async function POST() {
  try {
    await clearPainterSessionCookie();
    return NextResponse.json({ success: true });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/painter/auth/logout", PARTNER_ACTION_FAILED_ERROR);
  }
}
