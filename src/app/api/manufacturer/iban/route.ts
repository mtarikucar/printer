import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { manufacturers } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { normalizeIban, isValidTrIban } from "@/lib/services/iban";

const schema = z.object({ iban: z.string().min(1) });

// Manufacturer requests an IBAN change. The new value parks in `pendingIban`
// (review gate) — the live `iban` only changes once an admin approves.
export async function PATCH(request: NextRequest) {
  const session = await getManufacturerSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // IBAN is a payout-sensitive field. Mirror the profile route's gate: only an
  // active account may stage a payout-IBAN change. A 7-day session that outlives
  // a suspension must not be able to redirect payouts.
  const current = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
    columns: { status: true },
  });
  if (!current || current.status !== "active") {
    return NextResponse.json(
      { error: "Hesabınız aktif değil; IBAN değişikliği yapılamaz." },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "IBAN required" }, { status: 400 });
  }
  const iban = normalizeIban(parsed.data.iban);
  if (!isValidTrIban(iban)) {
    return NextResponse.json({ error: "Invalid Turkish IBAN" }, { status: 400 });
  }

  await db
    .update(manufacturers)
    .set({ pendingIban: iban, ibanReviewStatus: "pending", updatedAt: new Date() })
    .where(eq(manufacturers.id, session.manufacturerId));

  return NextResponse.json({ success: true });
}
