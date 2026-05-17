import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  verifyPassword,
  createSessionToken,
  setSessionCookie,
} from "@/lib/services/customer-auth";
import { rateLimitAsync, extractClientIp } from "@/lib/services/rate-limit";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

// Sentinel bcrypt hash used to keep the comparison branch's timing constant
// when the user doesn't exist. Pre-computed with bcrypt cost 12 so its work
// factor matches a real hash — without this, a missing user returns in
// ~5 ms but a present-but-wrong password takes ~200 ms, which is a trivial
// email-enumeration oracle.
const SENTINEL_BCRYPT =
  "$2b$12$RZK0p3CzMMqfMcU0VFqgvuKuUC4MQ3NQAvqWqOUiEDmlnsZ4n.gXq";

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);

  const ip = extractClientIp(request);
  // Per-IP cap (broad brute force) — async / Redis-backed across instances.
  const rlIp = await rateLimitAsync(`login:ip:${ip}`, 10, 15 * 60 * 1000);
  if (!rlIp.success) {
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

    // Per-email cap (narrow brute force / credential stuffing) — distinct
    // bucket so we throttle attackers regardless of IP rotation.
    const rlEmail = await rateLimitAsync(
      `login:email:${String(email).toLowerCase()}`,
      8,
      15 * 60 * 1000
    );
    if (!rlEmail.success) {
      return NextResponse.json(
        { error: "Too many login attempts. Please try again later." },
        { status: 429 }
      );
    }

    const user = await db.query.users.findFirst({
      where: eq(users.email, email),
    });

    // Always run bcrypt against either the real hash or a sentinel hash so the
    // miss path takes the same wall-clock time as the hit path. Without this,
    // a timing attack reliably enumerates registered emails.
    const hashToCheck = user?.passwordHash ?? SENTINEL_BCRYPT;
    const passwordValid = await verifyPassword(password, hashToCheck);

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

    if (!passwordValid) {
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
  } catch (error: unknown) {
    console.error("Login failed:", error);
    return NextResponse.json(
      { error: d["api.auth.loginFailed"] },
      { status: 500 }
    );
  }
}
