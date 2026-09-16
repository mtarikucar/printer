import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/services/customer-auth";
import { issueEmailVerification } from "@/lib/services/email-verification";
import { rateLimitAsync, extractClientIp } from "@/lib/services/rate-limit";
import { handleRouteFailure, AUTH_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

// Resend the verification email to the logged-in user. Rate-limited per IP and
// per user to prevent mailbombing. issueEmailVerification no-ops if already
// verified, so this is safe to call freely.
async function handlePOST(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }

  const ip = extractClientIp(request);
  const byIp = await rateLimitAsync(`resend-verif:ip:${ip}`, 10, 60 * 60 * 1000);
  const byUser = await rateLimitAsync(
    `resend-verif:user:${session.userId}`,
    5,
    60 * 60 * 1000
  );
  if (!byIp.success || !byUser.success) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.NODE_ENV === "production"
      ? "https://figurunica.com"
      : "http://localhost:3000");
  await issueEmailVerification(session.userId, appUrl);

  // Uniform response (don't reveal verified state to avoid enumeration noise).
  return NextResponse.json({ success: true });
}

/**
 * Beklenmeyen hata = GÖVDESİ OLAN cevap. İş yukarıdaki `handlePOST` içinde
 * yapılır; buradaki tek yakalama, Next'in sıfır baytlık 500'ü yerine ekranın
 * basabileceği TÜRKÇE bir cümle döndürür (gerekçe: src/lib/api/route-error.ts).
 */
export async function POST(request: NextRequest) {
  try {
    return await handlePOST(request);
  } catch (e) {
    return handleRouteFailure(e, "POST /api/auth/resend-verification", AUTH_ACTION_FAILED_ERROR);
  }
}
