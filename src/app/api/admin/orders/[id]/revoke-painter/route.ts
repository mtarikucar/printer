import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { adminActions, manufacturers, painters } from "@/lib/db/schema";
import { revokeAfterPainterHandoff } from "@/lib/services/revoke-after-painter";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { notifyPainter } from "@/lib/services/painter-notifications";
import { emitOrderChanged } from "@/lib/realtime/emit";

/**
 * Pull a painting order back from the painter to the assignment queue, detaching
 * both the painter and the manufacturer and reversing the manufacturer's accrued
 * print earning. See `revokeAfterPainterHandoff` for the invariants.
 */
const schema = z
  .object({
    reason: z.string().trim().min(3).max(500),
    blocklistManufacturer: z.boolean().default(true),
    blocklistPainter: z.boolean().default(false),
  })
  .strict();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const adminEmail = a.session.user.email ?? "admin";

  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Sebep zorunludur (en az 3 karakter)." },
      { status: 400 }
    );
  }
  const { reason, blocklistManufacturer, blocklistPainter } = parsed.data;

  const result = await revokeAfterPainterHandoff({
    orderId: id,
    adminEmail,
    reason,
    blocklistManufacturer,
    blocklistPainter,
  });

  if (result.code !== "ok") {
    const messages: Record<string, { message: string; status: number }> = {
      not_found: { message: "Sipariş bulunamadı.", status: 404 },
      not_handed_to_painter: {
        message: "Bu sipariş bir boyacıya devredilmemiş.",
        status: 400,
      },
      already_shipped: {
        message:
          "Sipariş kargolandı; geri alınamaz. İade/ihtilaf akışını kullanın.",
        status: 409,
      },
      wrong_status: {
        message: "Boyacı bu durumdayken geri alınamaz.",
        status: 409,
      },
      earning_settled: {
        message:
          "Üreticinin baskı hakedişi ödenmiş (payout kapanmış); boyacıdan geri alma yapılamaz. İade/ihtilaf akışını kullanın.",
        status: 409,
      },
      reverse_failed: {
        message:
          "Üretici hakedişi geri alınamadı; işlem iptal edildi. Lütfen tekrar deneyin.",
        status: 500,
      },
      lost_race: {
        message:
          "Sipariş bu sırada başka bir işlemle değiştirildi; sayfayı yenileyin.",
        status: 409,
      },
    };
    const m = messages[result.code] ?? {
      message: "Boyacıdan geri alınamadı.",
      status: 400,
    };
    return NextResponse.json({ error: m.message }, { status: m.status });
  }

  // Every side effect below is isolated: the order has already moved, so a
  // failing email or Redis must not turn this into a 500 the admin reads as
  // "nothing happened".
  const prevMfg = result.prevManufacturerId
    ? await db.query.manufacturers
        .findFirst({
          where: eq(manufacturers.id, result.prevManufacturerId),
          columns: { companyName: true },
        })
        .catch(() => null)
    : null;
  const prevPainter = await db.query.painters
    .findFirst({
      where: eq(painters.id, result.prevPainterId),
      columns: { companyName: true },
    })
    .catch(() => null);

  await db
    .insert(adminActions)
    .values({
      orderId: id,
      action: "assign_manufacturer",
      adminEmail,
      notes:
        `Boyacıdan geri alındı: üretici ${prevMfg?.companyName ?? result.prevManufacturerId ?? "-"} ` +
        `(${result.prevManufacturerStatus ?? "-"}) + boyacı ${prevPainter?.companyName ?? result.prevPainterId} ` +
        `(${result.prevPainterStatus}) → atama kuyruğuna döndü. Sebep: ${reason}`,
    })
    .catch((e) => console.error("revoke-painter: adminActions insert failed", e));

  if (result.prevManufacturerId) {
    await notifyManufacturer({
      manufacturerId: result.prevManufacturerId,
      type: "order_unassigned",
      subject: `Sipariş ataması geri alındı — ${result.orderNumber}`,
      body:
        `${result.orderNumber} numaralı siparişin ataması yönetici tarafından geri alındı ` +
        `ve sipariş yeniden atanacak.\n\nSebep: ${reason}\n\n` +
        `Bu sipariş artık üretici panelinizde görünmeyecektir.`,
      orderId: id,
    }).catch((e) =>
      console.error("revoke-painter: manufacturer notify failed", e)
    );
  }

  await notifyPainter({
    painterId: result.prevPainterId,
    type: "system_announcement",
    subject: `Boyama işi geri alındı — ${result.orderNumber}`,
    body:
      `${result.orderNumber} numaralı boyama işi yönetici tarafından geri alındı ` +
      `ve bu iş artık boyacı panelinizde görünmeyecektir.\n\nSebep: ${reason}`,
    orderId: id,
  }).catch((e) => console.error("revoke-painter: painter notify failed", e));

  // Reach the losing manufacturer's panel via its own topic (painter SSE is
  // deferred, so the painter is informed by e-mail above).
  await emitOrderChanged({
    orderId: id,
    orderNumber: result.orderNumber,
    userId: result.userId,
    manufacturerId: result.prevManufacturerId,
    status: result.orderStatus,
    manufacturerStatus: "unassigned",
  }).catch((e) => console.error("revoke-painter: emit failed", e));

  return NextResponse.json({
    success: true,
    prevManufacturer: prevMfg?.companyName ?? result.prevManufacturerId,
    prevPainter: prevPainter?.companyName ?? result.prevPainterId,
    prevPainterStatus: result.prevPainterStatus,
  });
}
