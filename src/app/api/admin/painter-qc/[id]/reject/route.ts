import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { orders, painterQcReviews, painterQcPhotos } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/require-admin";
import { painterQcNextStatus, type PainterOrderStatus } from "@/lib/services/painter-qc";
import { notifyPainter } from "@/lib/services/painter-notifications";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { REFUNDED_ORDER_ERROR, isRefunded } from "@/lib/config/order-status-policy";
import { isOrderRefunded, notRefundedGuard } from "@/lib/services/manufacturer-assign";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

/**
 * Gerekçe ZORUNLU: bu tur boyacıyı yeniden boyamaya gönderir ve boyacı, işin
 * neden döndüğünü bu metinden okur.
 *
 * Mesajlar zod'un kendi metnine BIRAKILMAZ: alan hiç gönderilmediğinde zod
 * "Invalid input: expected string, received undefined" üretir ve bu, doğrudan
 * çağrıda ya da eski bir istemcide yöneticinin ekranına İngilizce düşerdi.
 */
const schema = z.object({
  reason: z
    .string({ error: "Gerekçe gerekli." })
    .trim()
    .min(1, "Gerekçe gerekli.")
    .max(2000, "Gerekçe en fazla 2000 karakter olabilir."),
});

/** Doğrulama hatasını Türkçeleştirir; zod'un ham metni asla dışarı çıkmaz. */
function rejectionMessage(error: z.ZodError): string {
  return error.issues[0]?.code === "too_big"
    ? "Gerekçe en fazla 2000 karakter olabilir."
    : "Gerekçe gerekli.";
}

/**
 * Kararın GEREKÇE KAYDI yazılamadığında dönen cümle.
 *
 * "Hiçbir şey değişmedi" diyebiliyor, çünkü karar satırı ile durum yazması TEK
 * işlemdir: kayıt düşerse tur artışı da geri sarılır.
 */
const PAINTER_QC_DECISION_UNRECORDED_ERROR =
  "QC kararı kaydedilemedi (geçici sistem arızası): ret UYGULANMADI, iş QC beklemede kaldı ve " +
  "hiçbir şey değişmedi. Birkaç dakika sonra tekrar deneyin.";

// Admin rejects a painter's QC round: qc_pending → qc_rejected. The QC round is
// bumped so the painter re-paints and submits a fresh round of photos.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const { id } = await params;

    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: rejectionMessage(parsed.error) }, { status: 400 });
    }

    const order = await db.query.orders.findFirst({
      where: eq(orders.id, id),
      columns: {
        id: true, orderNumber: true, userId: true, manufacturerId: true,
        painterId: true, painterStatus: true, painterQcRound: true, paymentStatus: true,
      },
    });
    if (!order) return NextResponse.json({ error: "Sipariş bulunamadı" }, { status: 404 });
    // A rejection sends the painter back to repaint: forward work on money
    // already returned. A refunded order still attached stops here.
    if (isRefunded(order)) {
      return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
    }

    const next = painterQcNextStatus((order.painterStatus ?? "") as PainterOrderStatus, "reject");
    if (!next) return NextResponse.json({ error: "Sipariş QC reddine uygun değil" }, { status: 400 });

    // ── DURUM ve ONU HAKLI ÇIKARAN KAYIT TEK İŞLEMDİR ───────────────────────
    //
    // Ret turu artırır ve boyacıyı yeniden boyamaya yollar; boyacının okuduğu
    // gerekçe o karar satırında durur. Kayıt düşerken geçişin uygulanması,
    // sebebi hiçbir yerde yazmayan bir ret bırakırdı — ve aynı reddi tekrar
    // denemek 400 ("Zaten işlenmiş") verdiği için gerekçe bir daha yazılamazdı.
    const outcome = await db
      .transaction(async (tx) => {
        const [row] = await tx
          .update(orders)
          .set({
            painterStatus: next,
            painterQcRound: sql`${orders.painterQcRound} + 1`,
            updatedAt: new Date(),
          })
          // The guard again in the write, so a refund landing after the read wins.
          .where(and(eq(orders.id, id), eq(orders.painterStatus, "qc_pending"), notRefundedGuard()))
          .returning({ id: orders.id, orderNumber: orders.orderNumber, userId: orders.userId, manufacturerId: orders.manufacturerId, status: orders.status });
        if (!row) return null;
        await tx.insert(painterQcReviews).values({
          orderId: id, round: order.painterQcRound, decision: "rejected", reason: parsed.data.reason, adminEmail: a.session.user.email,
        });
        return row;
      })
      .catch((e) => {
        console.error("painter-qc/reject: QC kararı kaydedilemedi, ret geri sarıldı", e);
        return "unrecorded" as const;
      });
    if (outcome === "unrecorded") {
      return NextResponse.json(
        { error: PAINTER_QC_DECISION_UNRECORDED_ERROR, code: "qc_decision_unrecorded" },
        { status: 503 }
      );
    }
    if (!outcome) {
      if (await isOrderRefunded(id)) {
        return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
      }
      return NextResponse.json({ error: "Zaten işlenmiş" }, { status: 400 });
    }
    const updated = outcome;

    // Damgalama KAYIT işidir, kapı değil — ve reddin GEREKÇESİ de değildir; o
    // yüzden işlemin DIŞINDA, commit'ten SONRA durur. Fotoğraf tablosu
    // okunamazken ekran bu düğmeyi sunmaya devam ediyor (client.tsx ·
    // readFailures.painterQcPhotos); korumasız hâlinde admin "işlem
    // tamamlanamadı" okuyor ama ret UYGULANMIŞ oluyordu — ve aynı reddi bir daha
    // denemesi 400 ("Zaten işlenmiş") veriyordu.
    let photoStampFailed = false;
    try {
      await db
        .update(painterQcPhotos)
        .set({ reviewStatus: "rejected" })
        .where(and(eq(painterQcPhotos.orderId, id), eq(painterQcPhotos.round, order.painterQcRound)));
    } catch (e) {
      console.error("painter-qc/reject: QC fotoğraflarının durumu güncellenemedi", e);
      photoStampFailed = true;
    }

    if (order.painterId) {
      await notifyPainter({
        painterId: order.painterId,
        type: "qc_result",
        subject: "QC reddedildi",
        body: `${order.orderNumber} numaralı işin kalite kontrolü reddedildi. Gerekçe: ${parsed.data.reason}. Lütfen düzeltip yeni fotoğraflarla tekrar gönderin.`,
        orderId: id,
      }).catch((e) => console.error("notifyPainter (qc reject) failed", e));
    }
    await emitOrderChanged({
      orderId: updated.id, orderNumber: updated.orderNumber, userId: updated.userId,
      manufacturerId: updated.manufacturerId, status: updated.status,
    }).catch(() => {});

    // Ret geçerlidir; yalnız eski turun fotoğraf satırları damgalanamamış olabilir.
    return NextResponse.json({ success: true, photoStampFailed });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/painter-qc/[id]/reject", ADMIN_ACTION_FAILED_ERROR);
  }
}
