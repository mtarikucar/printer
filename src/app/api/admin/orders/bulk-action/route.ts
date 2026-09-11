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

  await db.transaction(async (tx) => {
    for (const order of eligible) {
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
          status: newStatus as typeof orders.$inferInsert.status,
          updatedAt: new Date(),
          ...(body.action === "approve" ? { manufacturerStatus: "unassigned" } : {}),
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

      emailJobs.push({
        email: order.email,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
      });

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

  return NextResponse.json({ success: true, processed, skipped });
}
