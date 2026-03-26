import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  verifyPassword,
  createSessionToken,
  setSessionCookie,
} from "@/lib/services/customer-auth";
import { rateLimit, extractClientIp } from "@/lib/services/rate-limit";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);

  const ip = extractClientIp(request);
  const rl = rateLimit(`login:${ip}`, 10, 15 * 60 * 1000); // 10 attempts per 15 min
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many login attempts. Please try again later." },
      { status: 429 }
    );
  }

  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: d["api.auth.emailPasswordRequired"] },
        { status: 400 }
      );
    }

    const user = await db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (!user) {
      return NextResponse.json(
        { error: d["api.auth.invalidCredentials"] },
        { status: 401 }
      );
    }

    if (!user.passwordHash) {
      return NextResponse.json(
        { error: d["api.auth.googleOnlyAccount"] },
        { status: 400 }
      );
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json(
        { error: d["api.auth.invalidCredentials"] },
        { status: 401 }
      );
    }

    const token = createSessionToken(user.id, user.email);
    await setSessionCookie(token);

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        phone: user.phone,
      },
    });
  } catch (error: any) {
    console.error("Login failed:", error);
    return NextResponse.json(
      { error: d["api.auth.loginFailed"] },
      { status: 500 }
    );
  }
}
