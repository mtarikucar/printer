import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orders, adminActions, meshReports, generationAttempts } from "@/lib/db/schema";
import { getEmailQueue } from "@/lib/queue/queues";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { emitOrderChanged } from "@/lib/realtime/emit";
import {
  openModelApproval,
  requiresCustomerModelApproval,
} from "@/lib/services/model-approval";
import { requiresOverride, type PrintGateVerdict } from "@/lib/services/print-gate";

/**
 * Admin approval of a reviewed order.
 *
 * Two roads out of `review`:
 *
 *  - An automatically generated model goes to `awaiting_customer_approval`.
 *    The manufacturer is NOT notified and no "your order is approved" email is
 *    sent, because from the customer's point of view nothing is approved yet —
 *    they still have to look at the turntable. Sending that email here would
 *    make the platform claim an approval the buyer never gave.
 *  - Everything else (marketplace, customer-supplied mesh, a model the admin
 *    sculpted by hand) keeps today's behaviour byte for byte.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);

  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const adminEmail = a.session.user.email;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const [current] = await db
    .select({
      id: orders.id,
      status: orders.status,
      orderType: orders.orderType,
      modelSource: orders.modelSource,
      modelGlbKey: orders.modelGlbKey,
    })
    .from(orders)
    .where(eq(orders.id, id))
    .limit(1);

  if (!current || current.status !== "review") {
    return NextResponse.json({ error: d["api.order.notInReview"] }, { status: 400 });
  }

  const needsCustomerApproval = requiresCustomerModelApproval(current);

  // In enforce mode a failing gate needs the admin to say, in writing, that
  // they looked and want it printed anyway. The human override is never
  // removed: KVKK art. 11/g gives a right to object to a purely automated
  // adverse decision, so a 409 here would be the wrong shape.
  if (needsCustomerApproval) {
    const [report] = await db
      .select({ verdict: meshReports.verdict })
      .from(meshReports)
      .innerJoin(generationAttempts, eq(meshReports.generationId, generationAttempts.id))
      .where(eq(generationAttempts.orderId, id))
      .limit(1);
    const verdict = (report?.verdict ?? "pass") as PrintGateVerdict;
    if (requiresOverride(verdict) && body.overrideGateFail !== true) {
      return NextResponse.json(
        {
          error:
            "Baskı kapısı bu modeli reddetti. Yine de onaylamak için gerekçe girin.",
          code: "gate_override_required",
        },
        { status: 409 }
      );
    }
  }

  const nextStatus = needsCustomerApproval ? "awaiting_customer_approval" : "approved";

  const [order] = await db
    .update(orders)
    .set({
      status: nextStatus,
      // Only a real approval opens the manufacturer queue.
      ...(needsCustomerApproval ? {} : { manufacturerStatus: "unassigned" as const }),
      adminNotes: body.notes,
      updatedAt: new Date(),
    })
    .where(and(eq(orders.id, id), eq(orders.status, "review")))
    .returning();

  if (!order) {
    return NextResponse.json({ error: d["api.order.notInReview"] }, { status: 400 });
  }

  await db.insert(adminActions).values({
    orderId: id,
    action: "approve",
    adminEmail,
    notes: body.overrideGateFail
      ? `[kapı override] ${body.overrideReason ?? "(gerekçe yok)"}${body.notes ? ` · ${body.notes}` : ""}`
      : body.notes,
  });

  if (needsCustomerApproval) {
    const approval = await openModelApproval({ orderId: id, channel: "email" });
    await getEmailQueue().add("model-approval", {
      type: "model_approval_request",
      to: order.email,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      approvalUrl: approval.approvalUrl,
      turntableUrl: approval.turntableUrl ?? undefined,
      locale,
    });
  } else {
    await getEmailQueue().add("approved", {
      type: "order_approved",
      to: order.email,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      locale,
    });
  }

  await emitOrderChanged({
    orderId: order.id,
    orderNumber: order.orderNumber,
    userId: order.userId,
    manufacturerId: order.manufacturerId,
    status: order.status,
    manufacturerStatus: order.manufacturerStatus,
  });

  return NextResponse.json({ success: true, status: nextStatus });
}
