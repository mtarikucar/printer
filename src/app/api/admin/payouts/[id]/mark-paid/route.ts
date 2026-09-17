import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { markPayoutPaid } from "@/lib/services/payouts";
import { markPainterPayoutPaid } from "@/lib/services/painter-payouts";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { notifyPainter } from "@/lib/services/painter-notifications";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";
import { payoutMarkPaidSchema, payoutFailure } from "../../_contract";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Ödeme partisi bulunamadı." }, { status: 404 });
    const parsed = payoutMarkPaidSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Geçerli partner türü, işlem türü ve güncel parti onayını gönderin. Mahsupta banka referansı boş olmalıdır." }, { status: 400 });
    const { kind, reference, expectedFingerprint, settlementKind } = parsed.data;
    // The service compares both the fingerprint and settlement kind under its
    // partner + batch locks. A route pre-read cannot prove either one.
    const confirmation = { adminEmail: a.session.user.email, expectedFingerprint, settlementKind };
    const result = kind === "manufacturer"
      ? await markPayoutPaid(id, reference, confirmation)
      : await markPainterPayoutPaid(id, reference, confirmation);
    if (!result.ok) {
      const failure = payoutFailure(result);
      return NextResponse.json(failure.body, { status: failure.status });
    }
    let warning: string | undefined;
    // A replay is not another transfer; netting never sends a bank-payment notice.
    if (!result.replayed && result.settlementKind === "transfer") {
      try {
        const notice = {
          subject: "Ödemeniz gönderildi",
          body: `${(result.totalKurus / 100).toLocaleString("tr-TR")} TL tutarındaki ödemeniz banka hesabınıza gönderildi.${reference ? ` Referans: ${reference}.` : ""}`,
        };
        if ("manufacturerId" in result) await notifyManufacturer({ manufacturerId: result.manufacturerId, type: "system_announcement", ...notice });
        else await notifyPainter({ painterId: result.painterId, type: "payout", ...notice });
      } catch (error) {
        console.error("payout completion notification failed", error);
        warning = "Ödeme kaydı tamamlandı ancak partner bildirimi gönderilemedi. Tekrar ödeme yapmayın; partneri bilgilendirin.";
      }
    }
    return NextResponse.json({ ok: true, success: true, replayed: result.replayed, settlementKind: result.settlementKind,
      message: result.settlementKind === "netting" ? "Mahsup tamamlandı; banka transferi yapılmadı." : "Banka ödemesi kaydedildi.", ...(warning ? { warning } : {}) });
  } catch (error) {
    return handleRouteFailure(error, "POST /api/admin/payouts/[id]/mark-paid", ADMIN_ACTION_FAILED_ERROR);
  }
}
