import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { manufacturers } from "@/lib/db/schema";
import type { TurkishAddress } from "@/lib/db/schema";
import { hashPassword } from "@/lib/services/manufacturer-auth";
import { rateLimitAsync, extractClientIp } from "@/lib/services/rate-limit";
import { parseTaxId } from "@/lib/services/tax-id";
import { isValidTrIban, normalizeIban } from "@/lib/services/iban";

// Turkish phone shape — see profile/route.ts for rationale.
const trPhoneRegex = /^(?:\+?90)?[2-5]\d{9}$/;

export async function POST(request: NextRequest) {
  const ip = extractClientIp(request);
  const rl = await rateLimitAsync(`mfr-register:${ip}`, 3, 60 * 60 * 1000);
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
    telefon: z.string().regex(trPhoneRegex, "Invalid phone number"),
  });

  const registerSchema = z.object({
    email: z.string().email("Invalid email address"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    companyName: z.string().min(1, "Company name is required").max(100),
    contactPerson: z.string().min(1, "Contact person is required").max(100),
    phone: z.string().regex(trPhoneRegex, "Invalid phone number"),
    whatsappPhone: z
      .string()
      .regex(trPhoneRegex, "Invalid WhatsApp phone")
      .optional()
      .nullable(),
    taxId: z.string().optional().nullable(),
    address: addressSchema,
    iban: z
      .string()
      .transform(normalizeIban)
      .refine(isValidTrIban, "Invalid IBAN (failed mod-97 checksum)"),
    bankAccountHolder: z.string().min(2).max(120),
    bankName: z.string().min(2).max(80),
    maxConcurrentOrders: z.number().int().min(1).max(50).default(5),
    onboardingAccepted: z.literal(true, {
      message: "Onboarding bilgilendirmesi onaylanmalıdır",
    }),
  });

  try {
    const body = await request.json();
    const validated = registerSchema.parse(body);

    let taxId: string | null = null;
    let taxIdType: "vkn" | "tckn" | null = null;
    let requiresManualTaxReview = true;

    if (validated.taxId && validated.taxId.trim() !== "") {
      const parsed = parseTaxId(validated.taxId);
      if (!parsed.ok) {
        return NextResponse.json({ error: "Invalid tax ID" }, { status: 400 });
      }
      taxId = parsed.normalized;
      taxIdType = parsed.type;
      requiresManualTaxReview = false;
    }

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

    const address: TurkishAddress = {
      adres: validated.address.adres,
      mahalle: validated.address.mahalle,
      ilce: validated.address.ilce,
      il: validated.address.il,
      postaKodu: validated.address.postaKodu,
      telefon: validated.address.telefon,
    };

    const [manufacturer] = await db
      .insert(manufacturers)
      .values({
        email: validated.email,
        passwordHash,
        companyName: validated.companyName,
        contactPerson: validated.contactPerson,
        phone: validated.phone,
        whatsappPhone: validated.whatsappPhone ?? null,
        address,
        taxId,
        taxIdType,
        requiresManualTaxReview,
        iban: validated.iban,
        bankAccountHolder: validated.bankAccountHolder,
        bankName: validated.bankName,
        maxConcurrentOrders: validated.maxConcurrentOrders,
        acceptingOrders: true,
        onboardingAcceptedAt: new Date(),
        status: "pending_approval",
      })
      .returning();

    // SECURITY: do not auto-issue a session cookie for a pending_approval
    // manufacturer. Until an admin activates the account, the user can't make
    // bank-detail edits, accept orders, or hit any manufacturer-scoped API.
    // After activation they will log in normally via /manufacturer/login.
    return NextResponse.json({
      manufacturer: {
        id: manufacturer.id,
        email: manufacturer.email,
        companyName: manufacturer.companyName,
        status: manufacturer.status,
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
    console.error("Manufacturer registration failed:", error);
    return NextResponse.json(
      { error: "Registration failed" },
      { status: 500 }
    );
  }
}
