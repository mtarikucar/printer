import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  hashPassword,
  createSessionToken,
  setSessionCookie,
} from "@/lib/services/customer-auth";
import { rateLimitAsync, extractClientIp } from "@/lib/services/rate-limit";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { phoneField } from "@/lib/phone";

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);

  const ip = extractClientIp(request);
  const rl = await rateLimitAsync(`register:${ip}`, 5, 60 * 60 * 1000); // 5 registrations per hour
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many registration attempts. Please try again later." },
      { status: 429 }
    );
  }

  const registerSchema = z.object({
    email: z.string().email(d["api.auth.emailInvalid"]),
    password: z.string().min(6, d["api.auth.passwordMin"]),
    fullName: z.string().min(1, d["api.auth.fullNameRequired"]).max(100),
    phone: phoneField(),
    // İYS opt-in (commercial electronic messages). Defaults false — consent
    // must be explicit. Recorded with a timestamp below.
    marketingConsent: z.boolean().optional().default(false),
  });

  try {
    const body = await request.json();
    const validated = registerSchema.parse(body);

    // Check if email already exists
    const existing = await db.query.users.findFirst({
      where: eq(users.email, validated.email),
    });

    if (existing) {
      // Do not allow setting password on a Google-only account via registration.
      // The user must be logged in via Google first, then set a password from account settings.
      return NextResponse.json(
        { error: d["api.auth.emailExists"] },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(validated.password);

    const [user] = await db
      .insert(users)
      .values({
        email: validated.email,
        passwordHash,
        fullName: validated.fullName,
        phone: validated.phone,
        marketingConsent: validated.marketingConsent,
        marketingConsentAt: validated.marketingConsent ? new Date() : null,
      })
      .returning();

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
    if (error instanceof Error && error.name === "ZodError") {
      const issues = (error as Error & { errors?: { message?: string }[] })
        .errors;
      return NextResponse.json(
        { error: issues?.[0]?.message ?? d["api.auth.registerFailed"] },
        { status: 400 }
      );
    }
    console.error("Registration failed:", error);
    return NextResponse.json(
      { error: d["api.auth.registerFailed"] },
      { status: 500 }
    );
  }
}
