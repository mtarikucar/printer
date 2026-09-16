import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { manufacturers } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { normalizeIban, isValidTrIban } from "@/lib/services/iban";
import { rateLimitAsync } from "@/lib/services/rate-limit";
import { handleRouteFailure, PARTNER_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

const schema = z.object({ iban: z.string().min(1) });

// PATCH only. There is no GET: the profile page reads the live IBAN and any
// change still waiting for admin review (pendingIban, ibanReviewStatus) from
// /api/manufacturer/auth/me, which is what it already loads. A GET that nothing
// called was removed rather than kept in step with /auth/me.

// Manufacturer requests an IBAN change. The new value parks in `pendingIban`
// (review gate, listed on /admin/kyc-queue) — the live `iban` only changes once
// an admin approves. This is the ONLY way a manufacturer changes their IBAN:
// the profile route used to write the live column directly, which skipped this
// gate while this route had no caller at all.
export async function PATCH(request: NextRequest) {
  try {
    const session = await getManufacturerSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Now that the profile page calls this, cap it like the profile route: every
    // call rewrites the value waiting in the admin queue.
    const rl = await rateLimitAsync(
      `mfr-iban:${session.manufacturerId}`,
      10,
      60 * 60 * 1000
    );
    if (!rl.success) {
      return NextResponse.json(
        { error: "Çok fazla IBAN değişikliği denemesi. Lütfen daha sonra tekrar deneyin." },
        { status: 429 }
      );
    }

    // IBAN is a payout-sensitive field. Mirror the profile route's gate: only an
    // active account may stage a payout-IBAN change. A 7-day session that outlives
    // a suspension must not be able to redirect payouts.
    const current = await db.query.manufacturers.findFirst({
      where: eq(manufacturers.id, session.manufacturerId),
      columns: { status: true, iban: true },
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
      return NextResponse.json({ error: "IBAN girin." }, { status: 400 });
    }
    const iban = normalizeIban(parsed.data.iban);
    if (!isValidTrIban(iban)) {
      // Turkish, because the manufacturer profile page shows this message as-is.
      return NextResponse.json(
        { error: "Geçersiz IBAN. TR ile başlayan 26 karakterlik IBAN'ı kontrol edin." },
        { status: 400 }
      );
    }

    // Re-submitting the live IBAN is not a change; queueing it would put a no-op
    // review in front of the admin.
    if (iban === current.iban) {
      return NextResponse.json({ success: true, unchanged: true });
    }

    await db
      .update(manufacturers)
      .set({ pendingIban: iban, ibanReviewStatus: "pending", updatedAt: new Date() })
      .where(eq(manufacturers.id, session.manufacturerId));

    return NextResponse.json({ success: true, pending: true });
  } catch (e) {
    return handleRouteFailure(e, "PATCH /api/manufacturer/iban", PARTNER_ACTION_FAILED_ERROR);
  }
}
