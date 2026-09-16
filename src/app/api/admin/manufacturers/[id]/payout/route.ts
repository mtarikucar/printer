import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createPayoutForManufacturer } from "@/lib/services/payouts";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

const fmtTRY = (kurus: number) => `₺${(kurus / 100).toLocaleString("tr-TR")}`;
// Checked before the query: a malformed id reached Postgres as an invalid uuid
// and came back as a 500. Same shape rule as the painter payout route.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Admin creates a payout batch from a manufacturer's not-yet-batched earnings.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Üretici bulunamadı." }, { status: 404 });
    }

    const result = await createPayoutForManufacturer(id, a.session.user.email);
    if (!result.ok) {
      // "Kuyruk boş" ile "aynı anda başka bir ödeme işlemi sürüyor" AYRI
      // cevaplardır. İkincisi tam da ölçülen yarıştır: üretici kendi talebini
      // bu düğmeyle aynı anda gönderdiğinde eskiden İKİ parti kuruluyor ve
      // ikisi de aynı hakedişleri sayıyordu. Artık partilemeyi biri alır,
      // öteki buradan dürüst bir sebeple döner.
      if (result.reason === "busy") {
        return NextResponse.json(
          {
            error:
              "Bu üreticinin ödemesi şu anda oluşturuluyor (üreticinin kendi talebi olabilir). Birkaç saniye sonra sayfayı yenileyip tekrar bakın; hiçbir hak ediş kaybolmadı.",
          },
          { status: 409 }
        );
      }
      // Also the normal outcome when the manufacturer's own payout request
      // batched these earnings after the admin loaded the page. The payouts page
      // alerts this text as-is, so it has to be Turkish.
      return NextResponse.json({ error: "Ödenecek bekleyen hak ediş yok." }, { status: 400 });
    }

    await notifyManufacturer({
      manufacturerId: id,
      type: "system_announcement",
      subject: "Ödeme talebiniz oluşturuldu",
      body: `${fmtTRY(result.totalKurus)} tutarında ödeme talebiniz oluşturuldu (${result.count} sipariş). Ödeme banka transferiyle yapıldığında ayrıca bilgilendirileceksiniz.`,
    }).catch((e) => console.error("notifyManufacturer (payout create) failed", e));

    return NextResponse.json({
      success: true,
      payoutId: result.payoutId,
      totalKurus: result.totalKurus,
      count: result.count,
    });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/manufacturers/[id]/payout", ADMIN_ACTION_FAILED_ERROR);
  }
}
