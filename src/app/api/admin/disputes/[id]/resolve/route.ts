import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { disputes } from "@/lib/db/schema";
import { reverseEarning } from "@/lib/services/payouts";
import { reversePainterEarning } from "@/lib/services/painter-payouts";
import { applyStrike } from "@/lib/services/strikes";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

const schema = z.object({
  action: z.enum(["resolve", "reject"]),
  resolution: z.string().trim().max(2000).optional(),
  clawback: z.boolean().optional(),
});

// Admin resolves/rejects a dispute. When resolving with clawback, the
// manufacturer's earning is reversed and a strike applied.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const { id } = await params;

    const body = await request.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const dispute = await db.query.disputes.findFirst({
      where: eq(disputes.id, id),
      with: { order: { columns: { id: true, manufacturerId: true } } },
    });
    if (!dispute) return NextResponse.json({ error: "Dispute not found" }, { status: 404 });
    if (dispute.status !== "open") {
      return NextResponse.json({ error: "Dispute already closed" }, { status: 400 });
    }

    const [updated] = await db
      .update(disputes)
      .set({
        status: parsed.data.action === "resolve" ? "resolved" : "rejected",
        resolution: parsed.data.resolution ?? null,
        adminEmail: a.session.user.email,
        resolvedAt: new Date(),
      })
      .where(and(eq(disputes.id, id), eq(disputes.status, "open")))
      .returning({ id: disputes.id });
    if (!updated) return NextResponse.json({ error: "Already closed" }, { status: 400 });

    // GERİ ALMANIN İKİ KARDEŞİ DE DENENİR VE SONUÇ SÖYLENİR.
    //
    // KAPANAN HATA: üretici tarafı `.catch`siz bekleniyordu, kardeşi ise bir
    // satır aşağıda `.catch`liydi. Üretici hakedişinin geri alınması patlayınca
    // rota fırlıyor, en dıştaki `catch` 500 dönüyordu — OYSA anlaşmazlık ÇÖZÜLDÜ
    // olarak ZATEN yazılmıştı (yukarıdaki korumalı UPDATE commit oldu). Kalan
    // hâl: kayıt "çözüldü" der, para geri ALINMAMIŞTIR ve ekranda yalnızca
    // "İşlem başarısız" yazar. Üstelik fırlama BOYACI tarafını hiç denemiyordu:
    // üreticininki patladığında boyacının hakedişi de geri alınmıyordu.
    //
    // Çözüm yazıldıktan SONRA "reddediyorum" demek artık mümkün değil (UPDATE
    // commit oldu, geri sarılacak bir şey yok). Bu yüzden dürüst olan tek
    // davranış: İKİSİNİ DE DENE — biri patlarken öbürü çalışsın, ikisi de
    // birbirinden bağımsızdır — ve NE OLUP OLMADIĞINI cevapta SÖYLE. Sessizce
    // yutmak, "para geri alındı" demekle aynı şeydir.
    //
    // Tekrar denemek güvenlidir (çevirme yüklemi `reversed`/`paid` satırları
    // atlar), ama bu EKRANDAN denenemez: liste yalnızca AÇIK anlaşmazlıkları
    // gösterir ve kayıt kapandı. Uyarı bunu olduğu gibi söyler.
    const reversalFailures: string[] = [];
    let strikeFailed = false;
    if (parsed.data.action === "resolve" && parsed.data.clawback) {
      await reverseEarning(dispute.order.id).catch((e) => {
        console.error("reverseEarning (clawback) failed", e);
        reversalFailures.push("üretici hak edişi");
      });
      // Also claw back the painter's earning for a painting order.
      await reversePainterEarning(dispute.order.id).catch((e) => {
        console.error("reversePainterEarning (clawback) failed", e);
        reversalFailures.push("boyacı hak edişi");
      });
      if (dispute.order.manufacturerId) {
        await notifyManufacturer({
          manufacturerId: dispute.order.manufacturerId,
          type: "system_announcement",
          subject: "Sipariş anlaşmazlığı sonucu hak ediş iadesi",
          body: "Bir müşteri anlaşmazlığı sizin aleyhinize sonuçlandığı için ilgili siparişin hak edişi geri alındı ve hesabınıza bir ihlal kaydı işlendi. Detaylar için üretici panelinizi inceleyin.",
          orderId: dispute.order.id,
        }).catch((e) => console.error("notifyManufacturer (clawback) failed", e));
        // İhlal kaydı da kardeşleri gibi yakalanır — YUTULARAK değil, cevaba
        // yazılarak. Buradan fırlamak 500 + gövdesiz cevap demekti: yukarıdaki
        // geri alma raporu admin'e HİÇ ulaşmazdı, yani raporu yazmanın anlamı
        // kalmazdı.
        await applyStrike(dispute.order.manufacturerId).catch((e) => {
          console.error("applyStrike (clawback) failed", e);
          strikeFailed = true;
        });
      }
    }

    // Rapor CEVABIN İÇİNDE: admin neyin yapıldığını, neyin yapılmadığını ve
    // bundan sonra ne yapması gerektiğini görür (istemci bunu ekrana basar).
    const warnings: string[] = [];
    if (reversalFailures.length > 0) {
      warnings.push(
        `Anlaşmazlık çözüldü olarak kaydedildi, ancak şu geri alma YAPILAMADI: ${reversalFailures.join(" ve ")}. Bu tutar hâlâ ödenebilir görünür ve bir ödeme partisine girebilir; anlaşmazlık kapandığı için bu ekrandan tekrar denenemez. Siparişin yönetici sayfasındaki para dökümünü kontrol edin ve geri alma yapılana kadar ilgili partnere ödeme onaylamayın.`
      );
    }
    if (strikeFailed) {
      warnings.push(
        "Üreticiye ihlal kaydı (strike) işlenemedi; üretici kaydını yönetici panelinden kontrol edin."
      );
    }

    return NextResponse.json({
      success: true,
      ...(warnings.length > 0 ? { warning: warnings.join(" ") } : {}),
    });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/disputes/[id]/resolve", ADMIN_ACTION_FAILED_ERROR);
  }
}
