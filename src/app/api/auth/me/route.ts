import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/services/customer-auth";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export async function GET(request: NextRequest) {
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

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      defaultAddress: user.defaultAddress,
    },
  });
}
