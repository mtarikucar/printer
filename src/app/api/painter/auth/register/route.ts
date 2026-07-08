import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { painters } from "@/lib/db/schema";
import type { TurkishAddress } from "@/lib/db/schema";
import { hashPassword } from "@/lib/services/painter-auth";
import { rateLimitAsync, extractClientIp } from "@/lib/services/rate-limit";
import { phoneField } from "@/lib/phone";

export async function POST(request: NextRequest) {
  const ip = extractClientIp(request);
  const rl = await rateLimitAsync(`painter-register:${ip}`, 3, 60 * 60 * 1000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many registration attempts. Please try again later." },
      { status: 429 }
    );
  }

  const addressSchema = z.object({
    adres: z.string().min(5),
    mahalle: z.string().optional(),
    ilce: z.string().min(1),
    il: z.string().min(1),
    postaKodu: z.string().min(4),
    telefon: phoneField(),
  });

  const registerSchema = z.object({
    email: z.string().email("Invalid email address"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    companyName: z.string().min(1, "Company name is required").max(100),
    contactPerson: z.string().min(1, "Contact person is required").max(100),
    phone: phoneField(),
    whatsappPhone: phoneField().optional().nullable(),
    address: addressSchema,
    // Painting techniques the painter offers (e.g. "airbrush", "hand", "resin").
    // Stored verbatim as capability tags; the assignment filter can route
    // painting jobs to painters that advertise the required technique.
    capabilities: z
      .array(z.string().min(1).max(40))
      .min(1, "En az bir boyama tekniği seçmelisiniz")
      .default(["hand"]),
    maxConcurrentOrders: z.number().int().min(1).max(50).default(5),
    onboardingAccepted: z.literal(true, {
      message: "Onboarding bilgilendirmesi onaylanmalıdır",
    }),
  });

  try {
    const body = await request.json();
    const validated = registerSchema.parse(body);

    // Normalize email to lowercase so case variants can't create duplicate
    // accounts or bypass the "already registered" check (login matches case-
    // insensitively too).
    const normalizedEmail = validated.email.toLowerCase();

    const existing = await db.query.painters.findFirst({
      where: sql`lower(${painters.email}) = ${normalizedEmail}`,
    });
    if (existing) {
      return NextResponse.json(
        { error: "This email is already registered" },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(validated.password);

    const address: TurkishAddress = {
      adres: validated.address.adres,
      mahalle: validated.address.mahalle,
      ilce: validated.address.ilce,
      il: validated.address.il,
      postaKodu: validated.address.postaKodu,
      telefon: validated.address.telefon,
    };

    const [painter] = await db
      .insert(painters)
      .values({
        email: normalizedEmail,
        passwordHash,
        companyName: validated.companyName,
        contactPerson: validated.contactPerson,
        phone: validated.phone,
        whatsappPhone: validated.whatsappPhone ?? null,
        address,
        capabilities: validated.capabilities,
        maxConcurrentOrders: validated.maxConcurrentOrders,
        acceptingOrders: true,
        onboardingAcceptedAt: new Date(),
        status: "pending_approval",
      })
      .returning();

    // SECURITY: do not auto-issue a session cookie here. A pending_approval
    // painter may log in later to view their status / upload a work sample, but
    // registration itself never mints a session — the admin approval + login
    // flow is the single place a painter_session cookie is set.
    return NextResponse.json({
      painter: {
        id: painter.id,
        email: painter.email,
        companyName: painter.companyName,
        status: painter.status,
      },
      pendingApproval: true,
      message:
        "Kaydınız alındı. Hesabınız admin onayına gönderildi; onay sonrasında giriş yapabilirsiniz.",
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Validation failed" },
        { status: 400 }
      );
    }
    console.error("Painter registration failed:", error);
    return NextResponse.json({ error: "Registration failed" }, { status: 500 });
  }
}
