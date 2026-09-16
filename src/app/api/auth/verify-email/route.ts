import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { consumeEmailVerification } from "@/lib/services/email-verification";
import { rateLimitAsync, extractClientIp } from "@/lib/services/rate-limit";
import { handleRouteFailure, AUTH_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

const bodySchema = z.object({ token: z.string().min(1) });

// Consume an email-verification token (the /verify-email/[token] page POSTs here).
async function handlePOST(request: NextRequest) {
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

/**
 * Beklenmeyen hata = GÖVDESİ OLAN cevap. İş yukarıdaki `handlePOST` içinde
 * yapılır; buradaki tek yakalama, Next'in sıfır baytlık 500'ü yerine ekranın
 * basabileceği TÜRKÇE bir cümle döndürür (gerekçe: src/lib/api/route-error.ts).
 */
export async function POST(request: NextRequest) {
  try {
    return await handlePOST(request);
  } catch (e) {
    return handleRouteFailure(e, "POST /api/auth/verify-email", AUTH_ACTION_FAILED_ERROR);
  }
}
