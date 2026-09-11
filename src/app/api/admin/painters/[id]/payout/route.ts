import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createPayoutForPainter } from "@/lib/services/painter-payouts";
import { notifyPainter } from "@/lib/services/painter-notifications";

const fmtTRY = (kurus: number) => `₺${(kurus / 100).toLocaleString("tr-TR")}`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Step 1 of the payout flow — the SAME two steps the manufacturer side uses:
// batch the painter's pending, not-yet-batched earnings into ONE pending
// payout here; mark it paid via /api/admin/payouts/[id]/mark-paid once the bank
// transfer has actually been sent.
//
// This route used to create the batch already "paid" in a single step. The
// admin had no moment to check IBAN / account holder before the database
// claimed the money had left, and a painter-requested batch (pending) and an
// admin-created one (paid) went through two different flows for the same
// thing. Reversed earnings are never captured (status must be 'pending').
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Ödenecek bekleyen kazanç yok" }, { status: 400 });
  }

  const result = await createPayoutForPainter(id, a.session.user.email);
  if (!result) {
    return NextResponse.json(
      { error: "Ödenecek bekleyen kazanç yok" },
      { status: 400 }
    );
  }

  await notifyPainter({
    painterId: id,
    type: "payout",
    subject: "Ödemeniz hazırlanıyor",
    body: `${fmtTRY(result.totalKurus)} tutarındaki ödemeniz oluşturuldu (${result.count} iş). Banka transferi yapıldığında ayrıca bilgilendirileceksiniz.`,
  }).catch((e) => console.error("notifyPainter (payout create) failed", e));

  return NextResponse.json({ success: true, ...result });
}
