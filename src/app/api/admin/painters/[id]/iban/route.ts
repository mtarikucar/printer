import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { painters } from "@/lib/db/schema";
import { notifyPainter } from "@/lib/services/painter-notifications";

const schema = z.object({ action: z.enum(["approve", "reject"]) });

// Admin approves/rejects a pending IBAN change. Approve promotes pendingIban to
// the live iban; reject discards it. Either way the review gate clears.
// Mirrors the manufacturer route — without it a painter's staged IBAN sat in
// `pending_iban` forever and the live one could never change.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { id } = await params;

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const painter = await db.query.painters.findFirst({
    where: eq(painters.id, id),
    columns: { pendingIban: true, ibanReviewStatus: true },
  });
  if (!painter) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (painter.ibanReviewStatus !== "pending") {
    return NextResponse.json({ error: "No pending IBAN change" }, { status: 400 });
  }

  if (parsed.data.action === "approve") {
    await db
      .update(painters)
      .set({
        iban: painter.pendingIban,
        pendingIban: null,
        ibanReviewStatus: "none",
        updatedAt: new Date(),
      })
      .where(eq(painters.id, id));
  } else {
    await db
      .update(painters)
      .set({ pendingIban: null, ibanReviewStatus: "none", updatedAt: new Date() })
      .where(eq(painters.id, id));
  }

  await notifyPainter({
    painterId: id,
    type: "system_announcement",
    subject:
      parsed.data.action === "approve"
        ? "IBAN değişikliğiniz onaylandı"
        : "IBAN değişikliğiniz reddedildi",
    body:
      parsed.data.action === "approve"
        ? "Yeni IBAN bilginiz onaylandı ve ödemeleriniz bu hesaba yapılacaktır."
        : "IBAN değişiklik talebiniz reddedildi. Mevcut IBAN bilginiz korunmaktadır. Lütfen bilgileri kontrol edip tekrar deneyin.",
  }).catch((e) => console.error("notifyPainter (iban) failed", e));

  return NextResponse.json({ success: true });
}
