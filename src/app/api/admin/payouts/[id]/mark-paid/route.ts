import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { markPayoutPaid } from "@/lib/services/payouts";
import { markPainterPayoutPaid } from "@/lib/services/painter-payouts";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { notifyPainter } from "@/lib/services/painter-notifications";

const schema = z.object({ reference: z.string().trim().max(120).optional() });
const fmtTRY = (kurus: number) => `₺${(kurus / 100).toLocaleString("tr-TR")}`;

// Admin marks a pending payout paid (after sending the bank transfer). Its
// earnings flip to "paid". Idempotent.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { id } = await params;

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  const reference = parsed.success ? parsed.data.reference ?? null : null;

  // The same payout id space covers both manufacturer and painter payouts. A
  // painter-initiated /api/painter/payout-request creates a PENDING painterPayouts
  // row and stamps its earnings' payoutId — those earnings are then invisible to
  // the admin batch-pay route (which only takes payoutId IS NULL), so this
  // mark-paid endpoint is the ONLY way to settle them. Try the manufacturer table
  // first, then fall back to the painter table.
  const result = await markPayoutPaid(id, reference);
  if (result) {
    await notifyManufacturer({
      manufacturerId: result.manufacturerId,
      type: "system_announcement",
      subject: "Ödemeniz gönderildi",
      body: `${fmtTRY(result.totalKurus)} tutarındaki ödemeniz banka hesabınıza gönderildi.${reference ? ` Referans: ${reference}.` : ""} Hesabınıza geçmesi bankanıza göre 1-2 iş günü sürebilir.`,
    }).catch((e) => console.error("notifyManufacturer (payout paid) failed", e));
    return NextResponse.json({ success: true });
  }

  const painterResult = await markPainterPayoutPaid(id, reference);
  if (painterResult) {
    await notifyPainter({
      painterId: painterResult.painterId,
      type: "payout",
      subject: "Ödemeniz gönderildi",
      body: `${fmtTRY(painterResult.totalKurus)} tutarındaki ödemeniz banka hesabınıza gönderildi.${reference ? ` Referans: ${reference}.` : ""} Hesabınıza geçmesi bankanıza göre 1-2 iş günü sürebilir.`,
    }).catch((e) => console.error("notifyPainter (payout paid) failed", e));
    return NextResponse.json({ success: true });
  }

  return NextResponse.json(
    { error: "Payout not found or already paid" },
    { status: 400 }
  );
}
