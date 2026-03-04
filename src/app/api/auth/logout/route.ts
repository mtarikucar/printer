import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/services/customer-auth";

export async function POST() {
  await clearSessionCookie();
  return NextResponse.json({ success: true });
}
