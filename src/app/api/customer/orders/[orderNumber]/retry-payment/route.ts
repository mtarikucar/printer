import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/services/customer-auth";
import { createPaytrToken } from "@/lib/services/paytr";
import { getClientIp } from "@/lib/utils/request";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

const retrySchema = z.object({
  // Only card retry is supported here; bank_transfer state is handled in /api/orders
  // (a new order, since the customer chose a different payment path).
  paymentMethod: z.literal("card").default("card"),
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

  // Parse but ignore for now — keeps the schema explicit if we expand later.
  await request.json().catch(() => ({}));
  retrySchema.parse({ paymentMethod: "card" });

  const order = await db.query.orders.findFirst({
    where: and(
      eq(orders.orderNumber, orderNumber),
      eq(orders.userId, session.userId)
    ),
  });

  if (!order) {
    return NextResponse.json({ error: d["api.order.notFound"] }, { status: 404 });
  }

  // Only retry orders that are still awaiting payment and haven't succeeded.
  if (order.status !== "pending_payment") {
    return NextResponse.json(
      { error: "Order is not in a retryable state" },
      { status: 400 }
    );
  }
  if (order.paymentMethod !== "card") {
    return NextResponse.json(
      { error: "Only card payments can be retried" },
      { status: 400 }
    );
  }
  if (order.paymentStatus === "succeeded") {
    return NextResponse.json({ error: "Order already paid" }, { status: 400 });
  }

  const addr = order.shippingAddress;
  const userIp = await getClientIp();
  const paymentAmountKurus = order.amountKurus - order.giftCardAmountKurus;
  const sizeLabel = d[`sizes.${order.figurineSize}` as keyof typeof d] || order.figurineSize;

  try {
    const paytrResult = await createPaytrToken({
      orderNumber: order.orderNumber,
      email: order.email,
      amountKurus: paymentAmountKurus,
      userName: order.customerName,
      userAddress: `${addr.mahalle ? addr.mahalle + ", " : ""}${addr.adres}, ${addr.ilce}/${addr.il}`,
      userPhone: addr.telefon,
      userIp,
      basket: [
        {
          name: `Figurin (${sizeLabel})`,
          priceTRY: (paymentAmountKurus / 100).toFixed(2),
          quantity: 1,
        },
      ],
      locale: order.locale,
    });

    await db
      .update(orders)
      .set({
        paytrMerchantOid: paytrResult.merchantOid,
        paytrTestMode: paytrResult.testMode,
        paymentStatus: "pending",
        paytrFailureReason: null,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, order.id));

    return NextResponse.json({
      orderNumber: order.orderNumber,
      iframeUrl: paytrResult.iframeUrl,
      finalAmountKurus: paymentAmountKurus,
    });
  } catch (err) {
    console.error("Retry PayTR token failed for", order.orderNumber, err);
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
