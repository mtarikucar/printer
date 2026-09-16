import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/services/customer-auth";
import { handleRouteFailure, CUSTOMER_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

// İYS opt-in/opt-out for the logged-in customer. marketingConsentAt records
// when consent was (re)granted; it is cleared when consent is withdrawn.
async function handlePATCH(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.marketingConsent !== "boolean") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const marketingConsent = body.marketingConsent as boolean;

  await db
    .update(users)
    .set({
      marketingConsent,
      marketingConsentAt: marketingConsent ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, session.userId));

  return NextResponse.json({ marketingConsent });
}

/**
 * Beklenmeyen hata = GÖVDESİ OLAN cevap. İş yukarıdaki `handlePATCH` içinde
 * yapılır; buradaki tek yakalama, Next'in sıfır baytlık 500'ü yerine ekranın
 * basabileceği TÜRKÇE bir cümle döndürür (gerekçe: src/lib/api/route-error.ts).
 */
export async function PATCH(request: NextRequest) {
  try {
    return await handlePATCH(request);
  } catch (e) {
    return handleRouteFailure(e, "PATCH /api/customer/marketing-consent", CUSTOMER_ACTION_FAILED_ERROR);
  }
}
