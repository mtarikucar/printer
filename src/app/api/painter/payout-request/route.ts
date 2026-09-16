import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { painters } from "@/lib/db/schema";
import { getPainterSession } from "@/lib/services/painter-auth";
import { createPayoutForPainter } from "@/lib/services/painter-payouts";
import { handleRouteFailure, PARTNER_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

// A painter requests payout of their pending earnings. The payout lands in the
// admin payouts queue to be paid.
//
// BU UÇ ARTIK KENDİ PARTİLEMESİNİ KURMAZ. Eskiden createPayoutForPainter'ın
// birebir kopyası buradaydı ve iki kopya ayrı ayrı bakım istiyordu: ödenebilirlik
// kuralı bir turda yalnız birinde düzeltilmişti. Şimdi tek yol var
// (painter-payouts.ts) ve o yol ATOMİK: sayım `for update of` ile kilitli
// okunur, partinin toplamı damganın kendisinden yazılır. Boyacının talebi ile
// admin'in "Ödeme oluştur"u aynı anda çalıştığında artık ikisi de başarılı
// dönüp aynı hakedişleri iki partiye yazamaz.
export async function POST() {
  try {
    const session = await getPainterSession();
    if (!session) {
      return NextResponse.json(
        { error: "unauthorized", message: "Oturumunuz sona ermiş. Yeniden giriş yapın." },
        { status: 401 }
      );
    }
    const painter = await db.query.painters.findFirst({
      where: eq(painters.id, session.painterId),
      columns: { status: true },
    });
    if (!painter || painter.status !== "active") {
      return NextResponse.json(
        {
          error: "not_active",
          message: "Hesabınız şu anda aktif değil; ödeme talebi oluşturulamaz.",
        },
        { status: 403 }
      );
    }

    // `adminEmail` = "painter-request": /admin/payouts bu partiyi "Boyacı talebi"
    // rozetiyle gösterir.
    const result = await createPayoutForPainter(session.painterId, "painter-request");
    if (!result.ok) {
      if (result.reason === "busy") {
        return NextResponse.json(
          {
            error: "payout_busy",
            message:
              "Ödemeniz şu anda oluşturuluyor (yöneticinin ya da sizin önceki talebiniz olabilir). Birkaç saniye sonra sayfayı yenileyin; kazancınız kaybolmaz.",
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: "nothing_owed", message: "Talep edilecek bekleyen kazanç yok." },
        { status: 400 }
      );
    }
    return NextResponse.json({
      ok: true,
      payoutId: result.payoutId,
      totalKurus: result.totalKurus,
      count: result.count,
    });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/painter/payout-request", PARTNER_ACTION_FAILED_ERROR);
  }
}
