import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { orders, orderPhotos } from "@/lib/db/schema";
import { PRICES_KURUS } from "@/lib/config/prices";
import { getSessionUser } from "@/lib/services/customer-auth";
import { createPaytrToken } from "@/lib/services/paytr";
import {
  calculateHavaleDiscount,
  HAVALE_DEADLINE_HOURS,
  HAVALE_REMINDER_HOURS,
  getBankDetails,
} from "@/lib/config/payment";
import {
  getEmailQueue,
  getPaymentDeadlineQueue,
  havaleExpireJobId,
  havaleReminderJobId,
} from "@/lib/queue/queues";
import { getClientIp } from "@/lib/utils/request";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

const reorderSchema = z.object({
  paymentMethod: z.enum(["card", "bank_transfer"]).default("card"),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderNumber: string }> }
) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);
  const { orderNumber } = await params;

  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json(
      { error: d["api.auth.notLoggedIn"] },
      { status: 401 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const { paymentMethod } = reorderSchema.parse(body);

  const order = await db.query.orders.findFirst({
    where: and(
      eq(orders.orderNumber, orderNumber),
      eq(orders.userId, session.userId)
    ),
    with: { photos: true },
  });

  if (!order) {
    return NextResponse.json({ error: d["api.order.notFound"] }, { status: 404 });
  }

  const NON_REORDERABLE = ["pending_payment", "rejected"];
  if (NON_REORDERABLE.includes(order.status)) {
    return NextResponse.json(
      { error: d["api.order.notReorderable"] },
      { status: 400 }
    );
  }

  const newOrderNumber = `FIG-${nanoid(8).toUpperCase()}`;
  const amountKurus = PRICES_KURUS[order.figurineSize];

  const havaleDiscountKurus =
    paymentMethod === "bank_transfer" ? calculateHavaleDiscount(amountKurus) : 0;
  const bankTransferDeadline =
    paymentMethod === "bank_transfer"
      ? new Date(Date.now() + HAVALE_DEADLINE_HOURS * 3600 * 1000)
      : null;

  const newOrder = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(orders)
      .values({
        orderNumber: newOrderNumber,
        userId: session.userId,
        email: order.email,
        customerName: order.customerName,
        phone: order.phone,
        figurineSize: order.figurineSize,
        style: order.style,
        modifiers: order.modifiers,
        shippingAddress: order.shippingAddress,
        amountKurus,
        status: "pending_payment",
        locale,
        paymentMethod,
        paymentStatus: paymentMethod === "bank_transfer" ? "awaiting_transfer" : "pending",
        havaleDiscountKurus,
        bankTransferDeadline,
      })
      .returning();

    if (order.photos.length > 0) {
      await tx.insert(orderPhotos).values({
        orderId: created.id,
        originalUrl: order.photos[0].originalUrl,
      });
    }

    return created;
  });

  // ─── Bank transfer ───────────────────────────────────────────
  if (paymentMethod === "bank_transfer") {
    const finalAmountKurus = amountKurus - havaleDiscountKurus;
    const bank = getBankDetails();

    const queue = getPaymentDeadlineQueue();
    await queue.add(
      "havale-reminder",
      { orderId: newOrder.id, orderNumber: newOrderNumber, type: "havale_reminder" },
      {
        jobId: havaleReminderJobId(newOrder.id),
        delay: HAVALE_REMINDER_HOURS * 3600 * 1000,
      }
    );
    await queue.add(
      "havale-expire",
      { orderId: newOrder.id, orderNumber: newOrderNumber, type: "havale_expire" },
      {
        jobId: havaleExpireJobId(newOrder.id),
        delay: HAVALE_DEADLINE_HOURS * 3600 * 1000,
      }
    );

    await getEmailQueue().add("send-email", {
      type: "bank_transfer_instructions",
      to: order.email,
      orderNumber: newOrderNumber,
      customerName: order.customerName,
      bankName: bank.bankName,
      bankAccountHolder: bank.accountHolder,
      bankIban: bank.iban,
      bankBranch: bank.branch,
      paymentAmountKurus: finalAmountKurus,
      paymentDeadline: bankTransferDeadline?.toISOString(),
      locale,
    });

    return NextResponse.json({
      orderNumber: newOrderNumber,
      paymentMethod: "bank_transfer",
      bankDetails: bank,
      finalAmountKurus,
      havaleDiscountKurus,
      deadline: bankTransferDeadline?.toISOString(),
    });
  }

  // ─── Card via PayTR ──────────────────────────────────────────
  const addr = order.shippingAddress;
  const userIp = await getClientIp();
  const sizeLabel = d[`sizes.${order.figurineSize}` as keyof typeof d] || order.figurineSize;

  try {
    const paytrResult = await createPaytrToken({
      orderNumber: newOrderNumber,
      email: order.email,
      amountKurus,
      userName: order.customerName,
      userAddress: `${addr.mahalle ? addr.mahalle + ", " : ""}${addr.adres}, ${addr.ilce}/${addr.il}`,
      userPhone: addr.telefon,
      userIp,
      basket: [
        {
          name: `Figurin (${sizeLabel})`,
          priceTRY: (amountKurus / 100).toFixed(2),
          quantity: 1,
        },
      ],
      locale,
    });

    await db
      .update(orders)
      .set({
        paytrMerchantOid: paytrResult.merchantOid,
        paytrTestMode: paytrResult.testMode,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, newOrder.id));

    return NextResponse.json({
      orderNumber: newOrderNumber,
      paymentMethod: "card",
      iframeUrl: paytrResult.iframeUrl,
    });
  } catch (err) {
    console.error("Reorder PayTR token failed for", newOrderNumber, err);
    const failureMessage = err instanceof Error ? err.message : "unknown";
    // Mark the just-created order as rejected so the customer can retry cleanly.
    await db
      .update(orders)
      .set({
        status: "rejected",
        paymentStatus: "failed",
        failureReason: `PayTR token error: ${failureMessage}`,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, newOrder.id));

    return NextResponse.json(
      {
        error:
          d["payment.paytr.tokenFailed"] ||
          "Ödeme başlatılamadı, lütfen tekrar deneyin.",
      },
      { status: 502 }
    );
  }
}
