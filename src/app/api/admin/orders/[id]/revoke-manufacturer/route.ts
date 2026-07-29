import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orders, adminActions, manufacturers } from "@/lib/db/schema";
import { revokeManufacturerAssignment } from "@/lib/services/manufacturer-revoke";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { applyStrike } from "@/lib/services/strikes";
import { emitOrderChanged } from "@/lib/realtime/emit";

/**
 * Take an assigned order back from a manufacturer, optionally handing it to a
 * specific one in the same call. Without this an unresponsive manufacturer
 * (neither accept nor decline) froze the order permanently.
 */
const schema = z
  .object({
    reason: z.string().trim().min(3).max(500),
    targetManufacturerId: z.string().uuid().optional(),
    // Keep the ranker from handing the order straight back.
    blocklist: z.boolean().default(true),
    // Reliability penalty — opt-in, since "did not answer" may be a holiday.
    strike: z.boolean().default(false),
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
  const { reason, targetManufacturerId, blocklist, strike } = parsed.data;

  // Validate the target up front so we don't revoke and then fail to reassign.
  let target: { id: string; companyName: string } | null = null;
  if (targetManufacturerId) {
    const found = await db.query.manufacturers.findFirst({
      where: and(
        eq(manufacturers.id, targetManufacturerId),
        eq(manufacturers.status, "active")
      ),
      columns: { id: true, companyName: true },
    });
    if (!found) {
      return NextResponse.json(
        { error: "Hedef üretici bulunamadı veya aktif değil." },
        { status: 400 }
      );
    }
    target = found;
  }

  const current = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    columns: { manufacturerId: true, customerName: true },
  });
  if (targetManufacturerId && current?.manufacturerId === targetManufacturerId) {
    return NextResponse.json(
      { error: "Sipariş zaten bu üreticide. Farklı bir üretici seçin." },
      { status: 400 }
    );
  }

  const result = await revokeManufacturerAssignment({
    orderId: id,
    adminEmail,
    reason,
    blocklist,
  });

  if (result.code !== "ok") {
    const messages: Record<string, { message: string; status: number }> = {
      not_found: { message: "Sipariş bulunamadı.", status: 404 },
      not_assigned: {
        message: "Siparişte aktif bir üretici ataması yok.",
        status: 400,
      },
      wrong_status: {
        message:
          "Bu aşamadan sonra atama geri alınamaz (QC onayı verilmiş veya kargolanmış). İade/ihtilaf akışını kullanın.",
        status: 409,
      },
      handed_to_painter: {
        message: "Bu sipariş boyacıya devredildi; üretici ataması geri alınamaz.",
        status: 409,
      },
      already_shipped: {
        message: "Sipariş kargolandı; geri alınamaz. İade akışını kullanın.",
        status: 409,
      },
      lost_race: {
        message:
          "Sipariş bu sırada başka bir işlemle değiştirildi; sayfayı yenileyin.",
        status: 409,
      },
    };
    const m = messages[result.code] ?? {
      message: "Atama geri alınamadı.",
      status: 400,
    };
    return NextResponse.json({ error: m.message }, { status: m.status });
  }

  const prevCompany = await db.query.manufacturers
    .findFirst({
      where: eq(manufacturers.id, result.prevManufacturerId),
      columns: { companyName: true },
    })
    .catch(() => null);
  const prevName = prevCompany?.companyName ?? result.prevManufacturerId;

  // Optional atomic hand-off. Guarded so a concurrent assignment wins cleanly:
  // the revoke itself already succeeded, so we still return 200.
  let reassigned = false;
  if (target) {
    const [row] = await db
      .update(orders)
      .set({
        manufacturerId: target.id,
        manufacturerStatus: "assigned",
        assignedToManufacturerAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(eq(orders.id, id), eq(orders.manufacturerStatus, "unassigned"))
      )
      .returning({ id: orders.id });
    reassigned = !!row;
  }

  // Every side effect below is isolated: the order has already moved, so a
  // failing email or Redis must not turn this into a 500 the admin reads as
  // "nothing happened".
  await db
    .insert(adminActions)
    .values({
      orderId: id,
      action: "assign_manufacturer",
      adminEmail,
      notes: reassigned
        ? `Geri alındı: ${prevName} (${result.prevStatus}) → yeniden atandı: ${target!.companyName}. Sebep: ${reason}`
        : `Atama geri alındı: ${prevName} (${result.prevStatus}) → kuyruğa döndü. Sebep: ${reason}`,
    })
    .catch((e) => console.error("revoke: adminActions insert failed", e));

  await notifyManufacturer({
    manufacturerId: result.prevManufacturerId,
    type: "order_unassigned",
    subject: `Sipariş ataması geri alındı — ${result.orderNumber}`,
    body:
      `${result.orderNumber} numaralı siparişin ataması yönetici tarafından geri alındı ` +
      `ve sipariş başka bir üreticiye yönlendirilecek.\n\n` +
      `Sebep: ${reason}\n\n` +
      `Bu sipariş artık üretici panelinizde görünmeyecektir. ` +
      `Yoğunluk nedeniyle sipariş alamıyorsanız panelinizdeki "Sipariş Alıyor" anahtarını kapatabilirsiniz.`,
    orderId: id,
  }).catch((e) =>
    console.error("revoke: losing-manufacturer notify failed", e)
  );

  if (strike) {
    await applyStrike(result.prevManufacturerId).catch((e) =>
      console.error("revoke: applyStrike failed", e)
    );
  }

  // The old manufacturer's panel only listens on its own topic, so the drop
  // needs its own emit — a single event cannot reach both sides.
  await emitOrderChanged({
    orderId: id,
    orderNumber: result.orderNumber,
    userId: result.userId,
    manufacturerId: result.prevManufacturerId,
    status: result.orderStatus,
    manufacturerStatus: "unassigned",
  }).catch((e) => console.error("revoke: emit (old manufacturer) failed", e));

  if (reassigned && target) {
    await notifyManufacturer({
      manufacturerId: target.id,
      type: "order_assigned",
      subject: `Yeni sipariş atandı — ${result.orderNumber}`,
      body:
        `Sayın ${target.companyName},\n\n` +
        `${result.orderNumber} numaralı sipariş size atandı.\n\n` +
        `Lütfen üretici panelinizden 24 saat içinde kabul veya reddedin.\n\n` +
        `Müşteri: ${current?.customerName ?? ""}`,
      orderId: id,
    }).catch((e) => console.error("revoke: new-manufacturer notify failed", e));

    await emitOrderChanged({
      orderId: id,
      orderNumber: result.orderNumber,
      userId: result.userId,
      manufacturerId: target.id,
      status: result.orderStatus,
      manufacturerStatus: "assigned",
    }).catch((e) => console.error("revoke: emit (new manufacturer) failed", e));
  }

  return NextResponse.json({
    success: true,
    reassigned,
    prevStatus: result.prevStatus,
    prevManufacturer: prevName,
  });
}
