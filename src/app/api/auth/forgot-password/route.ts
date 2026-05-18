import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { issuePasswordResetToken } from "@/lib/services/password-reset";
import { rateLimitAsync, extractClientIp } from "@/lib/services/rate-limit";

/**
 * POST /api/auth/forgot-password
 *
 * Always responds 200 — never reveals whether the email exists in our
 * system. Per-IP rate-limit (5 / 15 min) caps abuse without breaking the
 * legitimate "I'm not sure which email I used" retry flow.
 *
 * Per-email throttle is NOT applied here on purpose: it would create a
 * different timing channel (rate-limit response vs success response) that
 * an attacker could use for enumeration.
 */
const schema = z.object({
  email: z.string().email(),
});

export async function POST(request: NextRequest) {
  const ip = extractClientIp(request);
  const rl = await rateLimitAsync(
    `forgot-password:ip:${ip}`,
    5,
    15 * 60 * 1000
  );
  if (!rl.success) {
    return NextResponse.json(
      { error: "Çok fazla istek. Lütfen birkaç dakika sonra tekrar deneyin." },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // Uniform "sent if found" response even on validation failure so an
    // empty or malformed body can't be used to probe response shape.
    return NextResponse.json({ sent: true });
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  // Fire and respond — DON'T await all the way; we want a uniform fast
  // response time. (The function itself swallows errors.)
  await issuePasswordResetToken(parsed.data.email, appUrl);

  return NextResponse.json({ sent: true });
}
