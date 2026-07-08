import { NextRequest, NextResponse } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { painterEarnings, painterPayouts } from "@/lib/db/schema";
import { notifyPainter } from "@/lib/services/painter-notifications";

const bodySchema = z.object({ reference: z.string().max(200).optional() });

const fmtTRY = (kurus: number) => `₺${(kurus / 100).toLocaleString("tr-TR")}`;

// Admin batches a painter's not-yet-batched pending earnings into a single
// payout and marks it paid in one atomic step (mirrors the manufacturer payout
// route + markPayoutPaid, against the painter tables). Only earnings that are
// still `pending` and unbatched are captured; reversed ones are never paid.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { id } = await params;

  let reference: string | undefined;
  try {
    reference = bodySchema.parse(await request.json().catch(() => ({}))).reference;
  } catch {
    return NextResponse.json({ error: "Geçersiz istek" }, { status: 400 });
  }

  const result = await db.transaction(async (tx) => {
    const pending = await tx
      .select({
        id: painterEarnings.id,
        netKurus: painterEarnings.netKurus,
      })
      .from(painterEarnings)
      .where(
        and(
          eq(painterEarnings.painterId, id),
          eq(painterEarnings.status, "pending"),
          isNull(painterEarnings.payoutId)
        )
      );
    if (pending.length === 0) return null;

    const totalKurus = pending.reduce((s, e) => s + e.netKurus, 0);

    const [payout] = await tx
      .insert(painterPayouts)
      .values({
        painterId: id,
        totalKurus,
        earningCount: pending.length,
        adminEmail: a.session.user.email,
        status: "paid",
        reference: reference ?? null,
        paidAt: new Date(),
      })
      .returning({ id: painterPayouts.id });

    await tx
      .update(painterEarnings)
      .set({ status: "paid", payoutId: payout.id, updatedAt: new Date() })
      .where(
        and(
          eq(painterEarnings.painterId, id),
          eq(painterEarnings.status, "pending"),
          isNull(painterEarnings.payoutId)
        )
      );

    return { payoutId: payout.id, totalKurus, count: pending.length };
  });

  if (!result) {
    return NextResponse.json(
      { error: "Ödenecek bekleyen kazanç yok" },
      { status: 400 }
    );
  }

  await notifyPainter({
    painterId: id,
    type: "payout",
    subject: "Ödemeniz gerçekleştirildi",
    body: `${fmtTRY(result.totalKurus)} tutarındaki ödemeniz banka hesabınıza gönderildi (${result.count} iş).`,
  }).catch((e) => console.error("notifyPainter (payout) failed", e));

  return NextResponse.json({ success: true, ...result });
}
