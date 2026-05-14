import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { manufacturers } from "@/lib/db/schema";
import type { TurkishAddress } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";

const ibanRegex = /^TR\d{24}$/;

const addressSchema = z.object({
  adres: z.string().min(5),
  mahalle: z.string().optional(),
  ilce: z.string().min(1),
  il: z.string().min(1),
  postaKodu: z.string().min(4),
  telefon: z.string().min(10),
});

const profileSchema = z.object({
  contactPerson: z.string().min(1).max(100).optional(),
  phone: z.string().min(10).optional(),
  whatsappPhone: z.string().min(10).nullable().optional(),
  address: addressSchema.optional(),
  iban: z
    .string()
    .transform((v) => v.replace(/\s+/g, "").toUpperCase())
    .refine((v) => ibanRegex.test(v), "Invalid IBAN")
    .optional(),
  bankAccountHolder: z.string().min(2).max(120).optional(),
  bankName: z.string().min(2).max(80).optional(),
  maxConcurrentOrders: z.number().int().min(1).max(50).optional(),
  acceptingOrders: z.boolean().optional(),
});

export async function PATCH(request: NextRequest) {
  const session = await getManufacturerSession();
  if (!session) {
    return NextResponse.json({ error: "Not logged in" }, { status: 401 });
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
  if (validated.iban !== undefined) update.iban = validated.iban;
  if (validated.bankAccountHolder !== undefined) update.bankAccountHolder = validated.bankAccountHolder;
  if (validated.bankName !== undefined) update.bankName = validated.bankName;
  if (validated.maxConcurrentOrders !== undefined) update.maxConcurrentOrders = validated.maxConcurrentOrders;
  if (validated.acceptingOrders !== undefined) update.acceptingOrders = validated.acceptingOrders;
  update.updatedAt = new Date();

  await db
    .update(manufacturers)
    .set(update)
    .where(eq(manufacturers.id, session.manufacturerId));

  return NextResponse.json({ success: true });
}
