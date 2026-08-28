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
import { getWaOutboundQueue } from "@/lib/queue/queues";
import { waConversations } from "@/lib/db/schema";
import { APPROVAL_BUTTONS, WA_TEMPLATES } from "@/lib/config/whatsapp";

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
      waConversationId: orders.waConversationId,
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
    // The customer gets the approval turn where they actually are. A WhatsApp
    // buyer who is sent an e-mail link is a buyer who never answers.
    const viaWhatsApp = !!current.waConversationId;
    const approval = await openModelApproval({
      orderId: id,
      channel: viaWhatsApp ? "whatsapp" : "email",
    });

    if (viaWhatsApp) {
      const [conversation] = await db
        .select({ phoneE164: waConversations.phoneE164 })
        .from(waConversations)
        .where(eq(waConversations.id, current.waConversationId!))
        .limit(1);

      if (conversation) {
        await getWaOutboundQueue().add("model-approval", {
          conversationId: current.waConversationId!,
          to: conversation.phoneE164,
          kind: "buttons",
          body:
            `${order.customerName}, figürünüzün 3D modeli hazır! Baskıya başlamadan ` +
            `önce onayınızı istiyoruz. Sipariş no: ${order.orderNumber}`,
          buttons: [...APPROVAL_BUTTONS],
          ...(order.modelTurntableKey
            ? { headerMediaKey: order.modelTurntableKey, headerType: "video" as const }
            : {}),
          // The admin may well click this at 03:00, long after the customer's
          // 24-hour window has closed; the worker falls back to this template.
          templateName: WA_TEMPLATES.modelApproval,
          templateParams: [order.customerName, order.orderNumber],
          senderKind: "system",
        });
      }
    }

    // The e-mail goes out either way when we have an address: it carries the
    // /onay link, which is the channel-independent record of what was shown.
    if (order.email) {
      await getEmailQueue().add("model-approval", {
        type: "model_approval_request",
        to: order.email,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        approvalUrl: approval.approvalUrl,
        turntableUrl: approval.turntableUrl ?? undefined,
        locale,
      });
    }
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
