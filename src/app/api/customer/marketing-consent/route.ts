import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/services/customer-auth";

// İYS opt-in/opt-out for the logged-in customer. marketingConsentAt records
// when consent was (re)granted; it is cleared when consent is withdrawn.
export async function PATCH(request: NextRequest) {
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
