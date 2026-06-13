import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { consumeEmailVerification } from "@/lib/services/email-verification";
import { rateLimitAsync, extractClientIp } from "@/lib/services/rate-limit";

const bodySchema = z.object({ token: z.string().min(1) });

// Consume an email-verification token (the /verify-email/[token] page POSTs here).
export async function POST(request: NextRequest) {
  const ip = extractClientIp(request);
  const rl = await rateLimitAsync(`verify-email:${ip}`, 20, 15 * 60 * 1000);
  if (!rl.success) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let token: string;
  try {
    token = bodySchema.parse(await request.json()).token;
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const result = await consumeEmailVerification(token);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}
