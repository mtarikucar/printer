import { NextResponse } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { painters, painterEarnings, painterPayouts } from "@/lib/db/schema";
import { getPainterSession } from "@/lib/services/painter-auth";

// A painter requests payout of their pending earnings. Mirrors the manufacturer
// payout-request + createPayoutForManufacturer batching, against
// painterEarnings / painterPayouts. The payout lands in the admin payouts queue
// to be paid. Returns null → nothing owed.
export async function POST() {
  const session = await getPainterSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const painter = await db.query.painters.findFirst({
    where: eq(painters.id, session.painterId),
    columns: { status: true },
  });
  if (!painter || painter.status !== "active") {
    return NextResponse.json({ error: "Account not active" }, { status: 403 });
  }

  // Batch this painter's not-yet-batched pending earnings into one payout.
  const result = await db.transaction(async (tx) => {
    const pending = await tx
      .select({
        id: painterEarnings.id,
        netKurus: painterEarnings.netKurus,
      })
      .from(painterEarnings)
      .where(
        and(
          eq(painterEarnings.painterId, session.painterId),
          eq(painterEarnings.status, "pending"),
          isNull(painterEarnings.payoutId)
        )
      );
    if (pending.length === 0) return null;
    const totalKurus = pending.reduce((s, e) => s + e.netKurus, 0);
    const [payout] = await tx
      .insert(painterPayouts)
      .values({
        painterId: session.painterId,
        totalKurus,
        earningCount: pending.length,
        adminEmail: "painter-request",
        status: "pending",
      })
      .returning({ id: painterPayouts.id });
    await tx
      .update(painterEarnings)
      .set({ payoutId: payout.id, updatedAt: new Date() })
      .where(
        and(
          eq(painterEarnings.painterId, session.painterId),
          eq(painterEarnings.status, "pending"),
          isNull(painterEarnings.payoutId)
        )
      );
    return { payoutId: payout.id, totalKurus, count: pending.length };
  });

  if (!result) {
    return NextResponse.json({ error: "nothing_owed" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, ...result });
}
