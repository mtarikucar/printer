import { NextResponse } from "next/server";
import { clearManufacturerSessionCookie } from "@/lib/services/manufacturer-auth";
import { handleRouteFailure, PARTNER_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

export async function POST() {
  try {
    await clearManufacturerSessionCookie();
    return NextResponse.json({ success: true });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/manufacturer/auth/logout", PARTNER_ACTION_FAILED_ERROR);
  }
}
