import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { painters } from "@/lib/db/schema";
import type { TurkishAddress } from "@/lib/db/schema";
import { getPainterSession } from "@/lib/services/painter-auth";
import { rateLimitAsync } from "@/lib/services/rate-limit";
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
  companyName: z.string().min(1).max(100).optional(),
  contactPerson: z.string().min(1).max(100).optional(),
  phone: phoneField().optional(),
  whatsappPhone: phoneField().nullable().optional(),
  address: addressSchema.optional(),
  // Painting techniques offered — replaces the full set when provided.
  capabilities: z.array(z.string().min(1).max(40)).min(1).optional(),
  maxConcurrentOrders: z.number().int().min(1).max(50).optional(),
  acceptingOrders: z.boolean().optional(),
});

// Fields that materially affect job routing / capacity — restricted to active
// painters (mirrors the manufacturer profile's sensitive-field gate).
const SENSITIVE_FIELDS = ["maxConcurrentOrders", "acceptingOrders"] as const;

export async function PATCH(request: NextRequest) {
  const session = await getPainterSession();
  if (!session) {
    return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  }

  const rl = await rateLimitAsync(
    `painter-profile:${session.painterId}`,
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

  // Load current row so we can check status before applying sensitive changes.
  const current = await db.query.painters.findFirst({
    where: eq(painters.id, session.painterId),
  });
  if (!current) {
    return NextResponse.json({ error: "Painter not found" }, { status: 404 });
  }

  const wantsSensitiveChange = SENSITIVE_FIELDS.some(
    (k) => (validated as Record<string, unknown>)[k] !== undefined
  );
  if (wantsSensitiveChange && current.status !== "active") {
    return NextResponse.json(
      {
        error:
          "Hesabınız henüz aktif değil. Kapasite ve sipariş kabul ayarları yalnızca onaylı hesaplarda değiştirilebilir.",
      },
      { status: 403 }
    );
  }

  const update: Partial<typeof painters.$inferInsert> = {};
  if (validated.companyName !== undefined) update.companyName = validated.companyName;
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
  if (validated.capabilities !== undefined) update.capabilities = validated.capabilities;
  if (validated.maxConcurrentOrders !== undefined) update.maxConcurrentOrders = validated.maxConcurrentOrders;
  if (validated.acceptingOrders !== undefined) update.acceptingOrders = validated.acceptingOrders;
  update.updatedAt = new Date();

  await db
    .update(painters)
    .set(update)
    .where(eq(painters.id, session.painterId));

  return NextResponse.json({ success: true });
}
