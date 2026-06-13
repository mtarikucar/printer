import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/services/customer-auth";
import { verifyPhoneOtp } from "@/lib/services/phone-otp";
import { rateLimitAsync, extractClientIp } from "@/lib/services/rate-limit";

const bodySchema = z.object({ code: z.string().min(4).max(8) });

// Verify a phone-OTP code for the logged-in customer.
export async function POST(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }

  const ip = extractClientIp(request);
  const rl = await rateLimitAsync(`otp-verify:${session.userId}`, 15, 15 * 60 * 1000);
  const rlIp = await rateLimitAsync(`otp-verify:ip:${ip}`, 30, 15 * 60 * 1000);
  if (!rl.success || !rlIp.success) {
    return NextResponse.json({ error: "rate_limited", code: "rate_limited" }, { status: 429 });
  }

  let code: string;
  try {
    code = bodySchema.parse(await request.json()).code;
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const result = await verifyPhoneOtp(session.userId, code);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason, code: result.reason }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}
