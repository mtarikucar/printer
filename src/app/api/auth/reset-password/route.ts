import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { consumePasswordResetToken } from "@/lib/services/password-reset";
import { rateLimitAsync, extractClientIp } from "@/lib/services/rate-limit";

/**
 * POST /api/auth/reset-password
 *
 * Consumes the single-use reset token + sets the new password. Per-IP
 * rate-limit (10 / 15 min) caps brute-forcing tokens. Tokens are 32 bytes
 * of crypto.randomBytes encoded base64url (256 bits of entropy) so even an
 * unbounded attacker can't guess one in practice.
 */
const schema = z.object({
  token: z.string().min(20).max(120),
  password: z.string().min(6, "En az 6 karakter").max(200),
});

export async function POST(request: NextRequest) {
  const ip = extractClientIp(request);
  const rl = await rateLimitAsync(
    `reset-password:ip:${ip}`,
    10,
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
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validation failed" },
      { status: 400 }
    );
  }

  const result = await consumePasswordResetToken(
    parsed.data.token,
    parsed.data.password
  );

  if (!result.ok) {
    // Don't tell the client whether the token was "wrong" vs "expired" — both
    // outcomes prompt the same UX (request a new link).
    return NextResponse.json(
      { error: "Bağlantı geçersiz veya süresi dolmuş. Lütfen yeni bir sıfırlama isteği gönderin." },
      { status: 400 }
    );
  }

  return NextResponse.json({ success: true });
}
