import { NextRequest, NextResponse } from "next/server";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orders, adminActions } from "@/lib/db/schema";
import { getEmailQueue } from "@/lib/queue/queues";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { notRefundedGuard } from "@/lib/services/manufacturer-assign";
import { autoAssignIfEligible } from "@/lib/services/order-confirm";
import {
  openModelApproval,
  requiresCustomerModelApproval,
} from "@/lib/services/model-approval";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

const MAX_BULK_SIZE = 50;

// Every message is Turkish because any caller may show it as-is. Ids are shape-
// checked (guid: any 8-4-4-4-12 hex, what Postgres accepts, so a real row id is
// never refused) because a malformed one reached Postgres inside inArray and
// came back as a 500. The action is an enum because an unknown action used to
// fall through to start-printing.
const bodySchema = z.object(
  {
    orderIds: z
      .array(
        z
          .string({ error: "Geçersiz sipariş kimliği." })
          .guid({ error: "Geçersiz sipariş kimliği." }),
        { error: "Sipariş seçimi zorunludur." }
      )
      .min(1, { error: "En az bir sipariş seçin." })
      .max(MAX_BULK_SIZE, {
        error: `Toplu işlemde en fazla ${MAX_BULK_SIZE} sipariş seçilebilir.`,
      }),
    action: z.enum(["approve", "start-printing"], {
      error: "Geçersiz toplu işlem: onay ya da baskı başlatma seçin.",
    }),
  },
  { error: "Geçersiz istek." }
);

export async function POST(request: NextRequest) {
  try {
    const locale = getRequestLocale(request);

    const a = await requireAdmin();


    if ("response" in a) return a.response;


    const session = { user: { email: a.session.user.email } };

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Geçersiz istek." },
        { status: 400 }
      );
    }
    const body = parsed.data;

    const allOrders = await db.query.orders.findMany({
      where: inArray(orders.id, body.orderIds),
    });

    let processed = 0;
    let skipped = 0;

    const requiredStatus = body.action === "approve" ? "review" : "approved";
    const newStatus = body.action === "approve" ? "approved" : "printing";
    const actionType = body.action === "approve" ? "approve" : "print";
    const emailType = body.action === "approve" ? "order_approved" : "order_printing";
    const emailJobName = body.action === "approve" ? "approved" : "printing";

    const eligible = allOrders.filter((o) => o.status === requiredStatus);
    skipped = allOrders.length - eligible.length;

    // TOPLU ONAY, TEK ONAYLA AYNI YOLU İZLER.
    //
    // Onay rotasının (approve/route.ts) iki yolu vardır: otomatik üretilmiş model
    // taşıyan sipariş `awaiting_customer_approval`a gider ve üretici kuyruğu
    // AÇILMAZ, çünkü müşteri henüz tornayı görüp onaylamamıştır. Toplu işlem bunu
    // bilmediği için aynı siparişi doğrudan `approved` yapıyor, müşteriye "sipariş
    // onaylandı" e-postası atıyor ve üreticiye düşürüyordu: mesafeli sözleşmenin
    // üretimi müşterinin onayına bağlayan şartı toplu tıklamayla atlanıyordu.
    const needsCustomerApproval = (o: (typeof eligible)[number]) =>
      body.action === "approve" && requiresCustomerModelApproval(o);
    // WhatsApp'tan gelen onay turu şablon mesajı ister (approve rotası gönderir);
    // toplu işlem o turu açamaz, bu yüzden bu siparişler tek tek onaylanmalıdır.
    const waPending = eligible.filter((o) => needsCustomerApproval(o) && !!o.waConversationId);
    const batch = eligible.filter((o) => !waPending.includes(o));
    skipped += waPending.length;

    // Process all updates in a single transaction
    const emailJobs: Array<{
      email: string;
      orderNumber: string;
      customerName: string;
    }> = [];
    const emitJobs: Array<{
      orderId: string;
      orderNumber: string;
      userId: string | null;
      manufacturerId: string | null;
      status: string | null;
      manufacturerStatus: string | null;
    }> = [];

    // Müşteri onayına giden siparişlerin onay turu işlem SONRASI açılır.
    const approvalJobs: Array<{
      id: string;
      orderNumber: string;
      customerName: string;
      email: string;
    }> = [];

    await db.transaction(async (tx) => {
      for (const order of batch) {
        const toCustomerApproval = needsCustomerApproval(order);
        // Atomic status transition within transaction.
        // Both actions move an order forward, so both carry their single
        // route's refund guard: a refunded order keeps its status but is never
        // approved or printed (refund-end-state). It is counted as skipped, like
        // any other ineligible order.
        const conditions = [
          eq(orders.id, order.id),
          eq(orders.status, requiredStatus),
          notRefundedGuard(),
        ];
        // For start-printing, exclude manufacturer-assigned orders
        if (body.action === "start-printing") {
          conditions.push(isNull(orders.manufacturerId));
        }
        const [updated] = await tx
          .update(orders)
          .set({
            status: (toCustomerApproval
              ? "awaiting_customer_approval"
              : newStatus) as typeof orders.$inferInsert.status,
            updatedAt: new Date(),
            // Üretici kuyruğunu YALNIZ gerçek onay açar.
            ...(body.action === "approve" && !toCustomerApproval
              ? { manufacturerStatus: "unassigned" as const }
              : {}),
          })
          .where(and(...conditions))
          .returning();

        if (!updated) {
          skipped++;
          continue;
        }

        // The action note goes to adminActions only, never into
        // orders.adminNotes: that column carries the [SLA] / decline flags other
        // writers append, and an action must not overwrite them.
        await tx.insert(adminActions).values({
          orderId: order.id,
          action: actionType,
          adminEmail: session.user!.email!,
          notes: "Bulk action",
        });

        if (toCustomerApproval) {
          // "Siparişiniz onaylandı" e-postası GİTMEZ: müşterinin gözünde henüz
          // onaylanmış bir şey yok, onay sırası ONDA. Yerine onay turu açılır.
          approvalJobs.push({
            id: updated.id,
            orderNumber: updated.orderNumber,
            customerName: updated.customerName,
            email: updated.email,
          });
        } else {
          emailJobs.push({
            email: order.email,
            orderNumber: order.orderNumber,
            customerName: order.customerName,
          });
        }

        emitJobs.push({
          orderId: updated.id,
          orderNumber: updated.orderNumber,
          userId: updated.userId,
          manufacturerId: updated.manufacturerId,
          status: updated.status,
          manufacturerStatus: updated.manufacturerStatus,
        });

        processed++;
      }
    });

    // Enqueue emails after transaction commits
    for (const job of emailJobs) {
      await getEmailQueue().add(emailJobName, {
        type: emailType,
        to: job.email,
        orderNumber: job.orderNumber,
        customerName: job.customerName,
        locale,
      });
    }

    // Emit realtime change once per affected order after the transaction commits
    for (const job of emitJobs) {
      await emitOrderChanged(job);
    }

    // Müşteri onay turu: kanıt satırını (order_model_approvals) ve /onay linkini
    // tek onay rotasıyla AYNI servis üretir, böylece iki yol ayrışamaz.
    for (const job of approvalJobs) {
      try {
        const approval = await openModelApproval({ orderId: job.id, channel: "email" });
        if (job.email) {
          await getEmailQueue().add("model-approval", {
            type: "model_approval_request",
            to: job.email,
            orderNumber: job.orderNumber,
            customerName: job.customerName,
            approvalUrl: approval.approvalUrl,
            turntableUrl: approval.turntableUrl ?? undefined,
            locale,
          });
        }
      } catch (err) {
        console.error("[toplu onay] müşteri onay turu açılamadı", job.orderNumber, err);
      }
    }

    // Toplu onay da her siparişi "onaylı + atanmamış" hâline sokar, yani otomatik
    // atamanın tetiklendiği geçişlerden biridir.
    //
    // Yanıt BEKLENMEZ: 50 siparişin sıralaması (aday puanlama sorguları) tek bir
    // HTTP isteğine sığmaz ve admin'i saniyelerce bekletirdi. İş uzun ömürlü Node
    // sürecinde arka planda sürer; her atama kendi başına atomik ve tekrarlanabilir
    // olduğundan yarıda kalan bir tur yalnızca "atanmamış sipariş" bırakır, bozuk
    // durum bırakmaz. Fonksiyon asla fırlatmaz; yine de yüzen söz zinciri için
    // .catch bırakıldı.
    if (body.action === "approve" && emitJobs.length > 0) {
      // Müşteri onayına giden siparişler DIŞARIDA: orada üretici kuyruğu henüz
      // açılmamıştır, otomatik atama ancak müşteri onayladıktan sonra çalışır.
      const approvalIds = new Set(approvalJobs.map((j) => j.id));
      const ids = emitJobs.map((j) => j.orderId).filter((oid) => !approvalIds.has(oid));
      void (async () => {
        for (const orderId of ids) {
          await autoAssignIfEligible(orderId, { reason: "toplu onay" });
        }
      })().catch((err) =>
        console.error("[ATAMA] toplu onay sonrası otomatik atama hata verdi", err)
      );
    }

    return NextResponse.json({
      success: true,
      processed,
      skipped,
      // Admin "neden bazıları üreticiye düşmedi" sorusunun cevabını görsün.
      sentToCustomerApproval: approvalJobs.length,
      needsIndividualApproval: waPending.length,
    });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/orders/bulk-action", ADMIN_ACTION_FAILED_ERROR);
  }
}
