import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { manufacturers } from "@/lib/db/schema";
import type { TurkishAddress } from "@/lib/db/schema";
import { hashPassword } from "@/lib/services/manufacturer-auth";
import { rateLimitAsync, extractClientIp } from "@/lib/services/rate-limit";
import { parseTaxId } from "@/lib/services/tax-id";
import { isValidTrIban, normalizeIban } from "@/lib/services/iban";
import { phoneField } from "@/lib/phone";

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
    telefon: phoneField(),
  });

  const registerSchema = z.object({
    email: z.string().email("Invalid email address"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    companyName: z.string().min(1, "Company name is required").max(100),
    contactPerson: z.string().min(1, "Contact person is required").max(100),
    phone: phoneField(),
    whatsappPhone: phoneField().optional().nullable(),
    taxId: z.string().optional().nullable(),
    address: addressSchema,
    iban: z
      .string()
      .transform(normalizeIban)
      .refine(isValidTrIban, "Invalid IBAN (failed mod-97 checksum)"),
    bankAccountHolder: z.string().min(2).max(120),
    bankName: z.string().min(2).max(80),
    maxConcurrentOrders: z.number().int().min(1).max(50).default(5),
    // Which production materials this manufacturer prints. Stored as
    // `material_<m>` capability tags so the assignment filter can route orders
    // only to manufacturers that can print the order's material.
    materials: z
      .array(z.enum(["resin", "filament"]))
      .min(1, "En az bir üretim malzemesi seçmelisiniz")
      .default(["resin"]),
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

    // Normalize email to lowercase so case variants can't create duplicate
    // accounts or bypass the "already registered" check (login matches case-
    // insensitively too).
    const normalizedEmail = validated.email.toLowerCase();

    const existing = await db.query.manufacturers.findFirst({
      where: sql`lower(${manufacturers.email}) = ${normalizedEmail}`,
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
        email: normalizedEmail,
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
        capabilities: validated.materials.map((m) => `material_${m}`),
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
