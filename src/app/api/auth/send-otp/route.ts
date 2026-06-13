import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/services/customer-auth";
import { sendPhoneOtp } from "@/lib/services/phone-otp";
import { normalizePhone } from "@/lib/phone";
import { rateLimitAsync, extractClientIp } from "@/lib/services/rate-limit";

const bodySchema = z.object({ phone: z.string().min(5) });

// Send a phone-OTP SMS to the logged-in customer. SMS is a toll-fraud target,
// so it's tightly rate-limited per user and per IP.
export async function POST(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }

  const ip = extractClientIp(request);
  const byUser = await rateLimitAsync(`otp-send:user:${session.userId}`, 5, 60 * 60 * 1000);
  const byIp = await rateLimitAsync(`otp-send:ip:${ip}`, 15, 60 * 60 * 1000);
  if (!byUser.success || !byIp.success) {
    return NextResponse.json({ error: "rate_limited", code: "rate_limited" }, { status: 429 });
  }

  let phone: string;
  try {
    phone = bodySchema.parse(await request.json()).phone;
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const e164 = normalizePhone(phone);
  if (!e164) {
    return NextResponse.json({ error: "invalid_phone", code: "invalid_phone" }, { status: 400 });
  }

  try {
    await sendPhoneOtp(session.userId, e164);
  } catch (err) {
    console.error("[send-otp] failed:", err);
    return NextResponse.json({ error: "send_failed", code: "send_failed" }, { status: 502 });
  }
  return NextResponse.json({ success: true });
}
