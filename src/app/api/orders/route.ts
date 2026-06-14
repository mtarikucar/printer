import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  orderDrafts,
  previews,
  giftCards,
  giftCardRedemptions,
  users,
  products,
  uploadedModels,
  orderItems,
} from "@/lib/db/schema";
import { createOrderSchema } from "@/lib/validators/order";
import {
  createMarketplaceOrderSchema,
  createCartOrderSchema,
} from "@/lib/validators/product";
import { createUploadOrderSchema } from "@/lib/validators/upload";
import {
  allocatePaytrBasket,
  calculateUpsellAmount,
  itemPriceKurus,
} from "@/lib/config/prices";
import { priceKindForStyle, DEFAULT_TEMPLATE_SLUG } from "@/lib/create/design-templates";
import { getSessionUser } from "@/lib/services/customer-auth";
import { validateGiftCard } from "@/lib/services/gift-card";
import {
  buildDraftReference,
  promoteDraftToOrder,
} from "@/lib/services/order-draft";
import { createPaytrToken, buildMerchantOid } from "@/lib/services/paytr";
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
import {
  attributionFromRequest,
  attributionColumns,
} from "@/lib/analytics/attribution-server";
import { recordEvent } from "@/lib/analytics/server";
import { eq, and, or, isNull, count, inArray } from "drizzle-orm";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);

  try {
    const session = await getSessionUser();

    const body = await request.json();

    // Marketing attribution captured from first-party cookies (set by middleware)
    // — persisted on the draft and copied to the order on promotion, so every
    // paid order can be traced back to the campaign that drove it. The optional
    // client-supplied event id lets the browser AddPaymentInfo pixel and the
    // server-side event share a dedup id.
    const attribution = attributionFromRequest(request);
    const attrCols = attributionColumns(attribution);
    const clientPayEventId =
      typeof body?.analyticsEventId === "string" ? body.analyticsEventId : null;

    // Branch custom (photo→AI figurine) vs marketplace (buy a ready-made
    // product). Both share the address/payment/gift-card/guest fields, so we
    // parse into the matching schema and read shared fields via `common`.
    const orderType: "custom" | "marketplace" | "upload" =
      body?.orderType === "marketplace"
        ? "marketplace"
        : body?.orderType === "upload"
          ? "upload"
          : "custom";
    // A marketplace body with items[] is a multi-product cart checkout.
    const isCart = orderType === "marketplace" && Array.isArray(body?.items);

    const customInput =
      orderType === "custom" ? createOrderSchema(locale).parse(body) : null;
    const mpInput =
      orderType === "marketplace" && !isCart
        ? createMarketplaceOrderSchema(locale).parse(body)
        : null;
    const uploadInput =
      orderType === "upload" ? createUploadOrderSchema(locale).parse(body) : null;
    const cartInput = isCart ? createCartOrderSchema(locale).parse(body) : null;
    // Common checkout fields present in all schemas.
    const common = (customInput ?? mpInput ?? uploadInput ?? cartInput)!;

    // Marketplace: load + gate the product (only `active` listings are buyable).
    let product:
      | (typeof products.$inferSelect & {
          manufacturer: { status: string } | null;
        })
      | null = null;
    if (orderType === "marketplace" && !isCart) {
      product =
        (await db.query.products.findFirst({
          where: eq(products.id, mpInput!.productId),
          with: { manufacturer: { columns: { status: true } } },
        })) ?? null;
      if (!product || product.status !== "active") {
        return NextResponse.json(
          { error: d["api.order.productUnavailable"] ?? d["api.order.createFailed"] },
          { status: 400 }
        );
      }
      // A seller-owned product is only buyable while its seller is active. If
      // the seller was suspended after listing, the order would auto-assign to
      // them and then get stuck (they cannot accept) — refuse the purchase
      // instead. Platform/admin products (no manufacturer) are always buyable.
      if (
        product.ownerType === "seller" &&
        product.manufacturer?.status !== "active"
      ) {
        return NextResponse.json(
          { error: d["api.order.productUnavailable"] ?? d["api.order.createFailed"] },
          { status: 400 }
        );
      }
    }

    // Cart: load + gate every line's product; build the validated line list
    // (server-trusted prices). Same active-product + active-seller gates as the
    // single-product path.
    const cartLines: Array<{
      productId: string;
      sellerManufacturerId: string | null;
      titleSnapshot: string;
      unitPriceKurus: number;
      quantity: number;
      lineTotalKurus: number;
    }> = [];
    if (isCart) {
      const rows = await db.query.products.findMany({
        where: inArray(
          products.id,
          cartInput!.items.map((i) => i.productId)
        ),
        with: { manufacturer: { columns: { status: true } } },
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const item of cartInput!.items) {
        const p = byId.get(item.productId);
        if (
          !p ||
          p.status !== "active" ||
          (p.ownerType === "seller" && p.manufacturer?.status !== "active")
        ) {
          return NextResponse.json(
            { error: d["api.order.productUnavailable"] ?? d["api.order.createFailed"] },
            { status: 400 }
          );
        }
        cartLines.push({
          productId: p.id,
          sellerManufacturerId: p.manufacturerId ?? null,
          titleSnapshot: p.title,
          unitPriceKurus: p.priceKurus,
          quantity: item.quantity,
          lineTotalKurus: p.priceKurus * item.quantity,
        });
      }
    }

    // Upload: load + gate the customer's processed model — must be auto-priced
    // and ready. Possession of the UUID is the capability (mirrors previewId).
    let uploadedModel: typeof uploadedModels.$inferSelect | null = null;
    // Hoisted so the price-selection branch below uses the SAME quote-readiness
    // (incl. expiry) as the admission gate — never charging an expired quote.
    let quoteReady = false;
    if (orderType === "upload") {
      uploadedModel =
        (await db.query.uploadedModels.findFirst({
          where: eq(uploadedModels.id, uploadInput!.uploadedModelId),
        })) ?? null;
      // A model claimed by a logged-in user may only be ordered by that user.
      // Unclaimed (guest) models stay open — possession of the UUID is the
      // capability, mirroring previewId.
      if (uploadedModel?.userId && uploadedModel.userId !== session?.userId) {
        return NextResponse.json(
          { error: d["api.order.productUnavailable"] ?? d["api.order.createFailed"] },
          { status: 403 }
        );
      }
      const autoReady =
        uploadedModel?.status === "ready" && uploadedModel.priceKurus != null;
      // A manual quote is only honored before it expires — the admin sets
      // quoteExpiresAt (and the email advertises it), so an old quote must not
      // bind the platform to a stale price.
      quoteReady =
        uploadedModel?.quoteStatus === "quoted" &&
        uploadedModel.quotedPriceKurus != null &&
        (uploadedModel.quoteExpiresAt == null ||
          uploadedModel.quoteExpiresAt > new Date());
      if (!uploadedModel || (!autoReady && !quoteReady)) {
        return NextResponse.json(
          { error: d["api.order.productUnavailable"] ?? d["api.order.createFailed"] },
          { status: 400 }
        );
      }
    }

    // Custom orders may reference an approved preview; marketplace never does.
    const previewId: string | undefined =
      orderType === "custom" ? body.previewId : undefined;

    // Guest checkout (Q6): if no session, we expect guestEmail + guestName
    // in the body. We attach the order to an existing user with that email
    // OR create a guest user row (isGuest=true, no password). The customer
    // claims the row post-checkout via the email link.
    let user: typeof users.$inferSelect | undefined;
    if (session) {
      user = await db.query.users.findFirst({
        where: eq(users.id, session.userId),
      });
      if (!user) {
        return NextResponse.json({ error: d["api.auth.userNotFound"] }, { status: 401 });
      }
    } else {
      if (!common.guestEmail || !common.guestName) {
        return NextResponse.json(
          { error: d["api.auth.required"] },
          { status: 401 }
        );
      }
      const email = common.guestEmail.trim().toLowerCase();
      // Security (review C1): refuse to attach a guest order to an
      // existing user that has a real password OR is no longer flagged
      // as a guest. Otherwise an attacker who knows a victim's email
      // can mutate the victim's order history AND trigger the post-
      // purchase "claim your account" email, which contains a working
      // password-reset link to a real account.
      //
      // For existing GUEST rows (passwordHash=null, isGuest=true) we
      // do still attach — that's a returning guest placing a second
      // order before claiming. Their claim token rotates per order;
      // we accept the trade-off that the latest order's link is the
      // valid one (this is also the natural mental model for the
      // recipient).
      const existing = await db.query.users.findFirst({
        where: eq(users.email, email),
      });
      if (existing && (existing.passwordHash || !existing.isGuest)) {
        return NextResponse.json(
          {
            error: d["api.auth.emailRegistered"] ?? "Bu e-posta adresi kayıtlı. Lütfen giriş yapın.",
            code: "email_registered",
          },
          { status: 409 }
        );
      }
      if (existing) {
        user = existing;
      } else {
        // ON CONFLICT (email) DO NOTHING handles the race between two
        // simultaneous guest checkouts with the same email (review C2):
        // both miss findFirst, both attempt insert; the loser gets back
        // an empty array and we re-select.
        const inserted = await db
          .insert(users)
          .values({
            email,
            fullName: common.guestName,
            phone: common.shippingAddress.telefon,
            passwordHash: null,
            isGuest: true,
            marketingConsent: common.marketingConsent ?? false,
            marketingConsentAt: common.marketingConsent ? new Date() : null,
          })
          .onConflictDoNothing({ target: users.email })
          .returning();
        if (inserted[0]) {
          user = inserted[0];
        } else {
          // Concurrent insert won the race. Re-fetch and re-validate
          // (the row we now see might be a password-holding user if a
          // legitimate registration completed in between).
          const raced = await db.query.users.findFirst({
            where: eq(users.email, email),
          });
          if (!raced || raced.passwordHash || !raced.isGuest) {
            return NextResponse.json(
              {
                error: d["api.auth.emailRegistered"] ?? "Bu e-posta adresi kayıtlı. Lütfen giriş yapın.",
                code: "email_registered",
              },
              { status: 409 }
            );
          }
          user = raced;
        }
      }
    }

    if (previewId && typeof previewId !== "string") {
      return NextResponse.json({ error: d["api.order.createFailed"] }, { status: 400 });
    }

    if (
      orderType === "custom" &&
      (!customInput!.photoKey.startsWith("photos/") ||
        customInput!.photoKey.includes(".."))
    ) {
      return NextResponse.json({ error: d["api.order.createFailed"] }, { status: 400 });
    }

    const reference = buildDraftReference();
    // Dedupe upsells here so the DB row, gift-card math, and PayTR basket
    // all see the same canonical list (server-trusted, not client-trusted).
    const upsellKeys = Array.from(new Set(common.upsells));
    const upsellAmountKurus = calculateUpsellAmount(upsellKeys);
    // Item price: marketplace = seller-set price × quantity; custom = config
    // figurine price. figurinePriceKurus is NOT used for marketplace.
    const quantity = isCart
      ? cartLines.reduce((s, l) => s + l.quantity, 0)
      : orderType === "marketplace"
        ? mpInput!.quantity
        : 1;
    const itemAmountKurus = isCart
      ? cartLines.reduce((s, l) => s + l.lineTotalKurus, 0)
      : orderType === "marketplace"
        ? product!.priceKurus * quantity
        : orderType === "upload"
          ? quoteReady
            ? uploadedModel!.quotedPriceKurus!
            : uploadedModel!.priceKurus!
          : itemPriceKurus({
              kind: priceKindForStyle(customInput!.style),
              size: customInput!.figurineSize,
              material: customInput!.material,
              finish: customInput!.finish,
            });
    const amountKurus = itemAmountKurus + upsellAmountKurus;

    let giftCardId: string | undefined;
    if (common.giftCardCode) {
      const gcResult = await validateGiftCard(common.giftCardCode);
      if (!gcResult.valid) {
        const errorKey = `giftCard.error.${gcResult.error}` as keyof typeof d;
        return NextResponse.json({ error: d[errorKey] || d["common.error"] }, { status: 400 });
      }
      giftCardId = gcResult.card!.id;
    }

    // Reserve gift-card balance and create the draft atomically. The order row only
    // appears after payment is verified (PayTR webhook / OCR auto-confirm / admin).
    const deadlineCandidate = new Date(Date.now() + HAVALE_DEADLINE_HOURS * 3600 * 1000);

    const {
      draft,
      fullyCovered,
      giftCardAmountKurus,
      havaleDiscountKurus,
      bankTransferDeadline,
    } = await db.transaction(async (tx) => {
      if (previewId) {
        const [preview] = await tx
          .select()
          .from(previews)
          .where(
            and(
              eq(previews.id, previewId),
              or(eq(previews.userId, user!.id), isNull(previews.userId))
            )
          )
          .for("update");

        if (!preview || (preview.status !== "ready" && preview.status !== "approved")) {
          throw new Error("INVALID_PREVIEW");
        }

        await tx
          .update(previews)
          .set({ userId: user!.id, status: "approved", updatedAt: new Date() })
          .where(eq(previews.id, previewId));
      }

      let giftCardAmountKurus = 0;
      let isCovered = false;

      if (giftCardId) {
        const [card] = await tx
          .select()
          .from(giftCards)
          .where(eq(giftCards.id, giftCardId))
          .for("update");

        if (!card || card.balanceKurus <= 0) {
          throw new Error("INSUFFICIENT_BALANCE");
        }
        if (
          card.status === "expired" ||
          card.status === "fully_used" ||
          card.status === "pending_payment"
        ) {
          throw new Error("INSUFFICIENT_BALANCE");
        }
        if (card.expiresAt < new Date()) {
          throw new Error("INSUFFICIENT_BALANCE");
        }
        if (card.maxRedemptions !== null) {
          const [{ value: redemptionCount }] = await tx
            .select({ value: count() })
            .from(giftCardRedemptions)
            .where(eq(giftCardRedemptions.giftCardId, card.id));
          if (redemptionCount >= card.maxRedemptions) {
            throw new Error("LIMIT_REACHED");
          }
        }

        giftCardAmountKurus = Math.min(card.balanceKurus, amountKurus);
        isCovered = giftCardAmountKurus >= amountKurus;

        const newBalance = card.balanceKurus - giftCardAmountKurus;
        const newStatus = newBalance === 0 ? "fully_used" : "partially_used";

        await tx
          .update(giftCards)
          .set({
            balanceKurus: newBalance,
            status: newStatus as "fully_used" | "partially_used",
            updatedAt: new Date(),
          })
          .where(eq(giftCards.id, giftCardId));
      }

      const finalPaymentMethod: "card" | "bank_transfer" | "gift_card_full" = isCovered
        ? "gift_card_full"
        : common.paymentMethod === "bank_transfer"
        ? "bank_transfer"
        : "card";

      let havaleDiscountKurus = 0;
      let bankTransferDeadline: Date | null = null;
      let paytrMerchantOid: string | null = null;

      if (!isCovered && finalPaymentMethod === "bank_transfer") {
        havaleDiscountKurus = calculateHavaleDiscount(amountKurus - giftCardAmountKurus);
        bankTransferDeadline = deadlineCandidate;
      }
      if (!isCovered && finalPaymentMethod === "card") {
        paytrMerchantOid = buildMerchantOid(reference);
      }

      const [newDraft] = await tx
        .insert(orderDrafts)
        .values({
          reference,
          userId: user.id,
          previewId: previewId || null,
          uploadedModelId: orderType === "upload" ? uploadedModel!.id : null,
          email: user.email,
          customerName: user.fullName,
          phone: common.shippingAddress.telefon,
          // Custom item fields (null for marketplace).
          figurineSize: customInput?.figurineSize ?? null,
          style: customInput?.style ?? DEFAULT_TEMPLATE_SLUG,
          modifiers:
            customInput && customInput.modifiers.length > 0
              ? customInput.modifiers
              : null,
          // Material: custom from selection; marketplace inherits the product's
          // (display only), defaulting resin.
          material:
            isCart
              ? "resin"
              : orderType === "marketplace"
                ? product!.material ?? "resin"
                : orderType === "upload"
                  ? uploadedModel!.material
                  : customInput!.material,
          // Finish tier. Marketplace falls back to the default; upload prints
          // ship raw by default; custom uses the buyer's selection.
          finish:
            orderType === "marketplace"
              ? "paintable_kit"
              : orderType === "upload"
                ? "raw"
                : customInput!.finish,
          photoKey: customInput?.photoKey ?? null,
          // Marketplace item fields (null for custom).
          orderType,
          productId: orderType === "marketplace" && !isCart ? product!.id : null,
          sellerManufacturerId:
            orderType === "marketplace" && !isCart ? product!.manufacturerId : null,
          productTitleSnapshot: isCart
            ? `Sepet (${cartLines.length} ürün)`
            : orderType === "marketplace"
              ? product!.title
              : null,
          parentReference: isCart ? reference : null,
          quantity,
          shippingAddress: common.shippingAddress,
          locale,
          amountKurus,
          giftCardId: giftCardId || null,
          giftCardAmountKurus,
          havaleDiscountKurus,
          upsells: upsellKeys.length > 0 ? upsellKeys : null,
          upsellAmountKurus,
          paymentMethod: finalPaymentMethod,
          status: "pending",
          paytrMerchantOid,
          bankTransferDeadline,
          // Marketing attribution snapshot (denormalised cols + full JSON).
          ...attrCols,
        })
        .returning();

      if (giftCardId && giftCardAmountKurus > 0) {
        await tx.insert(giftCardRedemptions).values({
          giftCardId,
          draftId: newDraft.id,
          amountKurus: giftCardAmountKurus,
          redeemedByUserId: user.id,
        });
      }

      if (isCart) {
        await tx.insert(orderItems).values(
          cartLines.map((l) => ({
            draftId: newDraft.id,
            productId: l.productId,
            sellerManufacturerId: l.sellerManufacturerId,
            productTitleSnapshot: l.titleSnapshot,
            unitPriceKurus: l.unitPriceKurus,
            quantity: l.quantity,
            lineTotalKurus: l.lineTotalKurus,
          }))
        );
      }

      return {
        draft: newDraft,
        fullyCovered: isCovered,
        giftCardAmountKurus,
        havaleDiscountKurus,
        bankTransferDeadline,
      };
    });

    // ─── Fully covered by gift card → promote immediately ────────
    if (fullyCovered) {
      try {
        const promoted = await promoteDraftToOrder(draft.id);
        return NextResponse.json({
          reference: draft.reference,
          orderNumber: promoted.orderNumber,
          paymentMethod: "gift_card_full",
          autoConfirmed: true,
        });
      } catch (err) {
        console.error("Auto-promote failed for draft", draft.reference, err);
        return NextResponse.json({
          reference: draft.reference,
          autoConfirmed: false,
          error: "Auto-confirm failed, please contact support",
        });
      }
    }

    // ─── Server-truth "payment initiated" event ──────────────────
    // Fires for both card and havale (non-gift-card-covered) drafts. Uses the
    // browser-supplied event id when present so the AddPaymentInfo pixel and
    // this server event deduplicate at Meta/TikTok. Fire-and-forget: the
    // subsequent PayTR/email work keeps the function alive long enough to flush.
    void recordEvent({
      name: "add_payment_info",
      eventId: clientPayEventId ?? `payinit:${draft.reference}`,
      source: "server",
      reference: draft.reference,
      valueKurus: amountKurus - giftCardAmountKurus,
      userId: user.id,
      productId: draft.productId ?? null,
      attribution,
      consent: attribution.consent ?? null,
      visitorId: attribution.visitorId ?? null,
      sessionId: attribution.sessionId ?? null,
      user: { email: user.email, phone: common.shippingAddress.telefon },
    }).catch(() => {});

    // ─── Bank transfer (havale/EFT) ──────────────────────────────
    if (draft.paymentMethod === "bank_transfer") {
      const finalAmountKurus = amountKurus - giftCardAmountKurus - havaleDiscountKurus;
      const bank = getBankDetails();

      const paymentQueue = getPaymentDeadlineQueue();
      await paymentQueue.add(
        "havale-reminder",
        { draftId: draft.id, reference: draft.reference, type: "havale_reminder" },
        {
          jobId: havaleReminderJobId(draft.id),
          delay: HAVALE_REMINDER_HOURS * 3600 * 1000,
        }
      );
      await paymentQueue.add(
        "havale-expire",
        { draftId: draft.id, reference: draft.reference, type: "havale_expire" },
        {
          jobId: havaleExpireJobId(draft.id),
          delay: HAVALE_DEADLINE_HOURS * 3600 * 1000,
        }
      );

      await getEmailQueue().add("send-email", {
        type: "bank_transfer_instructions",
        to: user.email,
        orderNumber: draft.reference,
        customerName: user.fullName,
        bankName: bank.bankName,
        bankAccountHolder: bank.accountHolder,
        bankIban: bank.iban,
        bankBranch: bank.branch,
        paymentAmountKurus: finalAmountKurus,
        paymentDeadline: bankTransferDeadline?.toISOString(),
        locale,
      });

      return NextResponse.json({
        reference: draft.reference,
        paymentMethod: "bank_transfer",
        bankDetails: bank,
        finalAmountKurus,
        havaleDiscountKurus,
        giftCardAmountKurus,
        deadline: bankTransferDeadline?.toISOString(),
        redirectUrl: `/havale/${draft.reference}`,
      });
    }

    // ─── Card via PayTR ──────────────────────────────────────────
    const addr = common.shippingAddress;
    const userIp = await getClientIp();
    const paymentAmountKurus = amountKurus - giftCardAmountKurus;

    // Basket item name: marketplace = product title; custom = "Figurin (size ·
    // material)".
    let figurineName: string;
    if (isCart) {
      figurineName = `Sepet (${cartLines.length} ürün)`;
    } else if (orderType === "marketplace") {
      figurineName =
        quantity > 1 ? `${product!.title} × ${quantity}` : product!.title;
    } else if (orderType === "upload") {
      figurineName = `3D Model — ${uploadedModel!.fileName.slice(0, 60)}`;
    } else {
      const sizeLabel =
        d[`sizes.${customInput!.figurineSize}` as keyof typeof d] ||
        customInput!.figurineSize;
      const materialLabel =
        d[`material.${customInput!.material}` as keyof typeof d] ||
        customInput!.material;
      figurineName = `Figurin (${sizeLabel} · ${materialLabel})`;
    }

    // PayTR basket: figurine + per-upsell rows, summing to
    // paymentAmountKurus. See allocatePaytrBasket for the gift-card +
    // upsell edge-case handling (review C3).
    const basket = allocatePaytrBasket({
      paymentAmountKurus,
      figurineName,
      upsellAmountKurus,
      upsellKeys,
      upsellLabel: (key) =>
        (d[`upsell.${key}.label` as keyof typeof d] as string) || key,
    });

    try {
      const paytrResult = await createPaytrToken({
        orderNumber: draft.reference,
        email: user.email,
        amountKurus: paymentAmountKurus,
        userName: user.fullName,
        userAddress: `${addr.mahalle ? addr.mahalle + ", " : ""}${addr.adres}, ${addr.ilce}/${addr.il}`,
        userPhone: addr.telefon,
        userIp,
        basket,
        locale,
      });

      await db
        .update(orderDrafts)
        .set({
          paytrMerchantOid: paytrResult.merchantOid,
          paytrTestMode: paytrResult.testMode,
          updatedAt: new Date(),
        })
        .where(eq(orderDrafts.id, draft.id));

      return NextResponse.json({
        reference: draft.reference,
        paymentMethod: "card",
        iframeUrl: paytrResult.iframeUrl,
        paytrToken: paytrResult.token,
        finalAmountKurus: paymentAmountKurus,
      });
    } catch (err) {
      console.error("PayTR token creation failed for", draft.reference, err);
      const failureMessage = err instanceof Error ? err.message : "unknown";

      // Keep the draft in `pending` (not `failed`) so the customer can retry
      // via /api/customer/orders/[orderNumber]/retry-payment. The failure
      // reason is recorded for diagnostics.
      await db
        .update(orderDrafts)
        .set({
          paytrFailureReason: `PayTR token error: ${failureMessage}`,
          updatedAt: new Date(),
        })
        .where(eq(orderDrafts.id, draft.id));

      return NextResponse.json(
        {
          error:
            d["payment.paytr.tokenFailed"] ||
            "Ödeme başlatılamadı, lütfen tekrar deneyin.",
          reference: draft.reference,
          retryable: true,
        },
        { status: 502 }
      );
    }
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      const errors = (error as Error & { errors?: unknown }).errors;
      // Return the structured Zod issues array; never fall back to
      // `error.message`, which can leak internal validation details.
      return NextResponse.json(
        { error: errors ?? d["api.order.createFailed"] },
        { status: 400 }
      );
    }
    const msg = error instanceof Error ? error.message : "";
    if (msg === "INVALID_PREVIEW") {
      return NextResponse.json(
        { error: d["api.order.createFailed"] },
        { status: 400 }
      );
    }
    if (msg === "INSUFFICIENT_BALANCE") {
      return NextResponse.json(
        { error: d["giftCard.error.insufficient"] },
        { status: 400 }
      );
    }
    if (msg === "LIMIT_REACHED") {
      return NextResponse.json(
        { error: d["giftCard.error.limit_reached"] },
        { status: 400 }
      );
    }
    console.error("Order creation failed:", error);
    return NextResponse.json(
      { error: d["api.order.createFailed"] },
      { status: 500 }
    );
  }
}
