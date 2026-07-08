import { NextResponse } from "next/server";
import { clearPainterSessionCookie } from "@/lib/services/painter-auth";

export async function POST() {
  await clearPainterSessionCookie();
  return NextResponse.json({ success: true });
}
