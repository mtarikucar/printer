import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/services/customer-auth";
import { isPhoneVerificationRequired } from "@/lib/services/sms";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { handleRouteFailure, AUTH_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

async function handleGET(request: NextRequest) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);

  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: d["api.auth.notLoggedIn"] }, { status: 401 });
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
  });

  if (!user) {
    return NextResponse.json({ error: d["api.auth.userNotFound"] }, { status: 401 });
  }

  const adminEmails = process.env.ADMIN_EMAILS?.split(",").map((e) => e.trim().toLowerCase()) ?? [];

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      defaultAddress: user.defaultAddress,
      marketingConsent: user.marketingConsent,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      phoneVerificationRequired: isPhoneVerificationRequired(),
      isAdmin: adminEmails.includes(user.email.toLowerCase()),
    },
  });
}

/**
 * Beklenmeyen hata = GÖVDESİ OLAN cevap. İş yukarıdaki `handleGET` içinde
 * yapılır; buradaki tek yakalama, Next'in sıfır baytlık 500'ü yerine ekranın
 * basabileceği TÜRKÇE bir cümle döndürür (gerekçe: src/lib/api/route-error.ts).
 */
export async function GET(request: NextRequest) {
  try {
    return await handleGET(request);
  } catch (e) {
    return handleRouteFailure(e, "GET /api/auth/me", AUTH_ACTION_FAILED_ERROR);
  }
}
