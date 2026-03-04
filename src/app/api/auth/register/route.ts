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
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);

  const registerSchema = z.object({
    email: z.string().email(d["api.auth.emailInvalid"]),
    password: z.string().min(6, d["api.auth.passwordMin"]),
    fullName: z.string().min(1, d["api.auth.fullNameRequired"]).max(100),
    phone: z.string().min(10, d["api.auth.phoneMin"]),
  });

  try {
    const body = await request.json();
    const validated = registerSchema.parse(body);

    // Check if email already exists
    const existing = await db.query.users.findFirst({
      where: eq(users.email, validated.email),
    });

    if (existing) {
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
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json({ error: error.errors[0]?.message }, { status: 400 });
    }
    console.error("Registration failed:", error);
    return NextResponse.json(
      { error: d["api.auth.registerFailed"] },
      { status: 500 }
    );
  }
}
