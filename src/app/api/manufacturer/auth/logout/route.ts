import { NextResponse } from "next/server";
import { clearManufacturerSessionCookie } from "@/lib/services/manufacturer-auth";

export async function POST() {
  await clearManufacturerSessionCookie();
  return NextResponse.json({ success: true });
}
