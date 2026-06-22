import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orderDrafts } from "@/lib/db/schema";
import { findDraftByReference } from "@/lib/services/order-draft";
import { createPaytrToken, type PaytrBasketItem } from "@/lib/services/paytr";
import { getClientIp } from "@/lib/utils/request";
import { rateLimitAsync } from "@/lib/services/rate-limit";

/**
 * Mint a PayTR token for a pending draft, keyed ONLY by its reference — no
 * session. Safe because `reference` is FIG-<nanoid(8)> (~62^8), unguessable.
 * This powers the public payment link (/pay/<reference>) for admin-created
 * (WhatsApp) orders, and mirrors the customer retry-payment route: every call
 * uses a fresh merchant_oid suffix so re-opening the link can't collide on a
 * merchant_oid PayTR has already seen. The visitor's real IP is used for
 * user_ip so PayTR fraud checks see the actual payer.
 *
 * Because it is unauthenticated and each call makes an outbound PayTR get-token
 * request + rotates the draft's merchant_oid, it is rate-limited (per IP+ref and
 * a coarser per-ref cap) so it can't be spammed to grief an in-flight payment or
 * abuse PayTR's token API.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ reference: string }> }
) {
  const { reference } = await params;
  const ip = await getClientIp();

  const perIp = await rateLimitAsync(`paymint:${reference}:${ip}`, 6, 60_000);
  const perRef = await rateLimitAsync(`paymint:ref:${reference}`, 12, 60_000);
  if (!perIp.success || !perRef.success) {
    return NextResponse.json(
      { error: "Çok fazla deneme. Lütfen biraz sonra tekrar deneyin." },
      { status: 429 }
    );
  }

  const draft = await findDraftByReference(reference);
  if (!draft) {
    return NextResponse.json({ error: "Sipariş bulunamadı." }, { status: 404 });
  }
  if (draft.status !== "pending") {
    return NextResponse.json(
      { error: "Bu sipariş artık ödenebilir durumda değil." },
      { status: 400 }
    );
  }
  if (draft.paymentMethod !== "card") {
    return NextResponse.json(
      { error: "Bu sipariş kart ile ödenemiyor." },
      { status: 400 }
    );
  }

  const addr = draft.shippingAddress;
  const paymentAmountKurus = draft.amountKurus - draft.giftCardAmountKurus;
  const retrySuffix = `R${Date.now().toString(36)}`;

  // Single summary line that ALWAYS sums to payment_amount. A per-line basket
  // from selectedAddons would NOT reconcile for normal customer drafts that can
  // also reach this route (their selectedAddons hold only add-ons, not the base
  // price), so we deliberately send one line equal to the charged amount.
  const basket: PaytrBasketItem[] = [
    {
      name: draft.productTitleSnapshot || "Sipariş",
      priceTRY: (paymentAmountKurus / 100).toFixed(2),
      quantity: 1,
    },
  ];

  try {
    const paytrResult = await createPaytrToken({
      orderNumber: draft.reference,
      email: draft.email,
      amountKurus: paymentAmountKurus,
      userName: draft.customerName,
      userAddress: `${addr.mahalle ? addr.mahalle + ", " : ""}${addr.adres}, ${addr.ilce}/${addr.il}`,
      userPhone: addr.telefon,
      userIp: ip,
      basket,
      locale: draft.locale,
      merchantOidSuffix: retrySuffix,
    });

    await db
      .update(orderDrafts)
      .set({
        paytrMerchantOid: paytrResult.merchantOid,
        paytrTestMode: paytrResult.testMode,
        updatedAt: new Date(),
      })
      .where(eq(orderDrafts.id, draft.id));

    return NextResponse.json({ iframeUrl: paytrResult.iframeUrl });
  } catch (err) {
    console.error("Public pay PayTR token failed for", draft.reference, err);
    return NextResponse.json(
      { error: "Ödeme başlatılamadı, lütfen tekrar deneyin." },
      { status: 502 }
    );
  }
}
