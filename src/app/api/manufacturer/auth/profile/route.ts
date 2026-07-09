import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { manufacturers } from "@/lib/db/schema";
import type { TurkishAddress } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { rateLimitAsync } from "@/lib/services/rate-limit";
import { isValidTrIban, normalizeIban } from "@/lib/services/iban";
import { phoneField } from "@/lib/phone";

const addressSchema = z.object({
  adres: z.string().min(5),
  mahalle: z.string().optional(),
  ilce: z.string().min(1),
  il: z.string().min(1),
  postaKodu: z.string().min(4),
  telefon: phoneField(),
});

const profileSchema = z.object({
  contactPerson: z.string().min(1).max(100).optional(),
  phone: phoneField().optional(),
  whatsappPhone: phoneField().nullable().optional(),
  address: addressSchema.optional(),
  iban: z
    .string()
    .transform(normalizeIban)
    .refine(isValidTrIban, "Invalid IBAN (failed mod-97 checksum)")
    .optional(),
  bankAccountHolder: z.string().min(2).max(120).optional(),
  bankName: z.string().min(2).max(80).optional(),
  maxConcurrentOrders: z.number().int().min(1).max(50).optional(),
  acceptingOrders: z.boolean().optional(),
  paintsInHouse: z.boolean().optional(),
  // Production materials this manufacturer prints (at least one). Persisted as
  // `material_<m>` capability tags that drive material-based order routing.
  materials: z.array(z.enum(["resin", "filament"])).min(1).optional(),
});

// Fields that materially affect payouts / order routing — restricted to active
// manufacturers and re-flag for admin tax review when changed.
const SENSITIVE_FIELDS = [
  "iban",
  "bankAccountHolder",
  "bankName",
  "maxConcurrentOrders",
  "acceptingOrders",
  "paintsInHouse",
] as const;

export async function PATCH(request: NextRequest) {
  const session = await getManufacturerSession();
  if (!session) {
    return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  }

  const rl = await rateLimitAsync(
    `mfr-profile:${session.manufacturerId}`,
    30,
    60 * 60 * 1000
  );
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many profile updates. Please wait." },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let validated: z.infer<typeof profileSchema>;
  try {
    validated = profileSchema.parse(body);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Validation failed" },
        { status: 400 }
      );
    }
    throw err;
  }

  // Load current row so we can check status and detect IBAN changes.
  const current = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
  });
  if (!current) {
    return NextResponse.json({ error: "Manufacturer not found" }, { status: 404 });
  }

  const wantsSensitiveChange = SENSITIVE_FIELDS.some(
    (k) => (validated as Record<string, unknown>)[k] !== undefined
  );
  if (wantsSensitiveChange && current.status !== "active") {
    return NextResponse.json(
      {
        error:
          "Hesabınız henüz aktif değil. Banka bilgileri ve sipariş ayarları yalnızca onaylı hesaplarda değiştirilebilir.",
      },
      { status: 403 }
    );
  }

  const update: Partial<typeof manufacturers.$inferInsert> = {};
  if (validated.contactPerson !== undefined) update.contactPerson = validated.contactPerson;
  if (validated.phone !== undefined) update.phone = validated.phone;
  if (validated.whatsappPhone !== undefined) update.whatsappPhone = validated.whatsappPhone;
  if (validated.address) {
    const a = validated.address;
    update.address = {
      adres: a.adres,
      mahalle: a.mahalle,
      ilce: a.ilce,
      il: a.il,
      postaKodu: a.postaKodu,
      telefon: a.telefon,
    } satisfies TurkishAddress;
  }
  if (validated.iban !== undefined && validated.iban !== current.iban) {
    update.iban = validated.iban;
    // Bank-detail change re-flags for manual tax review so admin re-verifies
    // before any further payouts.
    update.requiresManualTaxReview = true;
  }
  if (validated.bankAccountHolder !== undefined) update.bankAccountHolder = validated.bankAccountHolder;
  if (validated.bankName !== undefined) update.bankName = validated.bankName;
  if (validated.maxConcurrentOrders !== undefined) update.maxConcurrentOrders = validated.maxConcurrentOrders;
  if (validated.acceptingOrders !== undefined) update.acceptingOrders = validated.acceptingOrders;
  if (validated.paintsInHouse !== undefined) update.paintsInHouse = validated.paintsInHouse;
  if (validated.materials !== undefined) {
    update.capabilities = validated.materials.map((m) => `material_${m}`);
  }
  update.updatedAt = new Date();

  await db
    .update(manufacturers)
    .set(update)
    .where(eq(manufacturers.id, session.manufacturerId));

  return NextResponse.json({ success: true });
}
