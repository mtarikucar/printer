import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { orders, orderPhotos, previews } from "@/lib/db/schema";
import { createOrderSchema } from "@/lib/validators/order";
import { getPaytrToken, getIframeUrl, PRICES_KURUS } from "@/lib/services/paytr";
import { getPublicUrl } from "@/lib/services/storage";
import { getSessionUser } from "@/lib/services/customer-auth";
import { users } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);

  try {
    // Require authentication
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: d["api.auth.required"] }, { status: 401 });
    }

    const body = await request.json();
    const validated = createOrderSchema(locale).parse(body);
    const previewId: string | undefined = body.previewId;

    // Get user info
    const user = await db.query.users.findFirst({
      where: eq(users.id, session.userId),
    });
    if (!user) {
      return NextResponse.json({ error: d["api.auth.userNotFound"] }, { status: 401 });
    }

    // Validate previewId if provided
    if (previewId) {
      const preview = await db.query.previews.findFirst({
        where: and(
          eq(previews.id, previewId),
          eq(previews.userId, session.userId)
        ),
      });
      if (!preview || (preview.status !== "ready" && preview.status !== "approved")) {
        return NextResponse.json(
          { error: d["api.order.createFailed"] },
          { status: 400 }
        );
      }
      // Mark preview as approved
      await db
        .update(previews)
        .set({ status: "approved", updatedAt: new Date() })
        .where(eq(previews.id, previewId));
    }

    const orderNumber = `FIG-${nanoid(8).toUpperCase()}`;
    const photoUrl = getPublicUrl(validated.photoKey);
    const amountKurus = PRICES_KURUS[validated.figurineSize];

    const [order] = await db
      .insert(orders)
      .values({
        orderNumber,
        userId: user.id,
        previewId: previewId || null,
        email: user.email,
        customerName: user.fullName,
        phone: validated.shippingAddress.telefon,
        figurineSize: validated.figurineSize,
        shippingAddress: validated.shippingAddress,
        amountKurus,
        paytrMerchantOid: orderNumber,
        status: "pending_payment",
      })
      .returning();

    await db.insert(orderPhotos).values({
      orderId: order.id,
      originalUrl: photoUrl,
    });

    // Get user IP from headers
    const userIp =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "127.0.0.1";

    const paytrToken = await getPaytrToken({
      merchantOid: orderNumber,
      email: user.email,
      paymentAmount: amountKurus,
      userName: user.fullName,
      userAddress: `${validated.shippingAddress.adres}, ${validated.shippingAddress.ilce}/${validated.shippingAddress.il}`,
      userPhone: validated.shippingAddress.telefon,
      userIp,
      figurineSize: validated.figurineSize,
      locale,
    });

    return NextResponse.json({
      orderNumber,
      paytrToken,
      iframeUrl: getIframeUrl(paytrToken),
    });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    console.error("Order creation failed:", error);
    return NextResponse.json(
      { error: d["api.order.createFailed"] },
      { status: 500 }
    );
  }
}
