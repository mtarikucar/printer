import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturers } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { createPayoutForManufacturer } from "@/lib/services/payouts";
import { handleRouteFailure, PARTNER_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

// Faz 6: a manufacturer requests payout of their pending earnings. Reuses the
// admin batching logic; the payout lands in the admin payouts queue to be paid.
//
// AYNI PARTİLEME YOLU: bu uç kendi sorgusunu kurmaz, createPayoutForManufacturer
// çağırır. Partileme orada ATOMİKTİR (payout-claim.ts): admin aynı anda "Ödeme
// oluştur"a bassa bile iki parti kurulamaz — biri kümeyi alır, öteki "bekleyen
// hak ediş yok" ya da "başka bir işlem sürüyor" cevabını alır.
//
// Her hata Türkçe bir `message` taşır: düğme bunu olduğu gibi basar. Eskiden
// yalnız İngilizce bir `error` kodu dönüyordu ve düğme onu gösteremediği için
// başarısız talep SESSİZ kalıyordu — üretici düğmeye basıp hiçbir şey olmadığını
// görüyordu.
export async function POST() {
  try {
    const session = await getManufacturerSession();
    if (!session) {
      return NextResponse.json(
        { error: "unauthorized", message: "Oturumunuz sona ermiş. Yeniden giriş yapın." },
        { status: 401 }
      );
    }
    const manufacturer = await db.query.manufacturers.findFirst({
      where: eq(manufacturers.id, session.manufacturerId),
      columns: { status: true },
    });
    if (!manufacturer || manufacturer.status !== "active") {
      return NextResponse.json(
        {
          error: "not_active",
          message: "Hesabınız şu anda aktif değil; ödeme talebi oluşturulamaz.",
        },
        { status: 403 }
      );
    }

    const result = await createPayoutForManufacturer(
      session.manufacturerId,
      "manufacturer-request"
    );
    if (!result.ok) {
      // İki ret AYRI cevaptır: "kuyruk boş" ile "aynı anda başka bir ödeme
      // işlemi sürüyor" farklı şeyler söyler ve üreticinin yapacağı da farklı.
      if (result.reason === "busy") {
        return NextResponse.json(
          {
            error: "payout_busy",
            message:
              "Ödemeniz şu anda oluşturuluyor (yöneticinin ya da sizin önceki talebiniz olabilir). Birkaç saniye sonra sayfayı yenileyin; hak edişiniz kaybolmaz.",
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: "nothing_owed", message: "Talep edilecek bekleyen hak ediş yok." },
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
    return handleRouteFailure(e, "POST /api/manufacturer/payout-request", PARTNER_ACTION_FAILED_ERROR);
  }
}
