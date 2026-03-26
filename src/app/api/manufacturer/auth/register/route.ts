import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { manufacturers } from "@/lib/db/schema";
import {
  hashPassword,
  createManufacturerSessionToken,
  setManufacturerSessionCookie,
} from "@/lib/services/manufacturer-auth";
import { rateLimit, extractClientIp } from "@/lib/services/rate-limit";

export async function POST(request: NextRequest) {
  const ip = extractClientIp(request);
  const rl = rateLimit(`mfr-register:${ip}`, 3, 60 * 60 * 1000); // 3 per hour
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many registration attempts. Please try again later." },
      { status: 429 }
    );
  }

  const registerSchema = z.object({
    email: z.string().email("Invalid email address"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    companyName: z.string().min(1, "Company name is required").max(100),
    contactPerson: z.string().min(1, "Contact person is required").max(100),
    phone: z.string().min(10, "Phone number must be at least 10 characters"),
  });

  try {
    const body = await request.json();
    const validated = registerSchema.parse(body);

    // Check if email already exists
    const existing = await db.query.manufacturers.findFirst({
      where: eq(manufacturers.email, validated.email),
    });

    if (existing) {
      return NextResponse.json(
        { error: "This email is already registered" },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(validated.password);

    const [manufacturer] = await db
      .insert(manufacturers)
      .values({
        email: validated.email,
        passwordHash,
        companyName: validated.companyName,
        contactPerson: validated.contactPerson,
        phone: validated.phone,
        status: "pending_approval",
      })
      .returning();

    const token = createManufacturerSessionToken(
      manufacturer.id,
      manufacturer.email
    );
    await setManufacturerSessionCookie(token);

    return NextResponse.json({
      manufacturer: {
        id: manufacturer.id,
        email: manufacturer.email,
        companyName: manufacturer.companyName,
        status: manufacturer.status,
      },
    });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json(
        { error: error.errors[0]?.message },
        { status: 400 }
      );
    }
    console.error("Manufacturer registration failed:", error);
    return NextResponse.json(
      { error: "Registration failed" },
      { status: 500 }
    );
  }
}
