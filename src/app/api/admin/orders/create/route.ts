import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orderDrafts } from "@/lib/db/schema";
import { resolveOrCreateGuestUser } from "@/lib/services/guest-user";
import { buildDraftReference } from "@/lib/services/order-draft";

/**
 * Admin creates an order on a customer's behalf (e.g. an order negotiated over
 * WhatsApp) and gets back a shareable payment link. We create a pending
 * `orderDrafts` row — exactly the same artifact the web checkout produces — so
 * the rest of the pipeline (PayTR webhook / havale confirm → promoteDraftToOrder)
 * works unchanged. The customer pays at /pay/<reference>; no account needed.
 *
 * Origin is tagged via `attributionChannel: "whatsapp"` (no migration); it is
 * copied onto the promoted order, so WhatsApp orders are queryable later.
 */
const lineItemSchema = z.object({
  description: z.string().trim().min(1).max(120),
  unitPriceTry: z.number().positive().max(1_000_000),
  quantity: z.number().int().min(1).max(999),
});

const addressSchema = z.object({
  adres: z.string().trim().min(1).max(300),
  mahalle: z.string().trim().max(120).optional().default(""),
  ilce: z.string().trim().min(1).max(120),
  il: z.string().trim().min(1).max(120),
  postaKodu: z.string().trim().max(20).optional().default(""),
  telefon: z.string().trim().min(1).max(40),
});

const schema = z.object({
  customerName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  shippingAddress: addressSchema,
  lineItems: z.array(lineItemSchema).min(1).max(20),
  paymentMethod: z.enum(["card", "bank_transfer"]),
  // Reference photos the customer sent over WhatsApp (storage keys from
  // /api/admin/orders/upload-photo). Max 4; become order_photos at promotion.
  photoKeys: z.array(z.string().trim().min(1).max(300)).max(4).optional(),
});

export async function POST(request: NextRequest) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Geçersiz form verisi.", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const input = parsed.data;

  // Resolve the buyer the same way guest checkout does (returning-guest attach,
  // new-guest create) — but as an ADMIN taking the order on the customer's
  // behalf (WhatsApp), attaching to an EXISTING registered account is legitimate
  // and expected, so we opt out of the guest-checkout "email_registered" refusal.
  // That refusal exists to stop a stranger on the public checkout from attaching
  // orders to someone else's account; an authenticated admin is not that threat.
  const guest = await resolveOrCreateGuestUser({
    email: input.email,
    name: input.customerName,
    phone: input.shippingAddress.telefon,
    allowExistingAccount: true,
  });
  if (!guest.ok) {
    return NextResponse.json(
      {
        error: "Müşteri hesabı çözümlenemedi. Lütfen tekrar deneyin.",
        code: "user_resolve_failed",
      },
      { status: 409 }
    );
  }
  const user = guest.user;

  // Each line item becomes a {name, priceKurus} addon row — the column type
  // fits exactly and it doubles as the PayTR basket on the pay page. priceKurus
  // is the LINE total (unit × qty).
  const lineItems = input.lineItems.map((li) => ({
    name: li.quantity > 1 ? `${li.description} × ${li.quantity}` : li.description,
    priceKurus: Math.round(li.unitPriceTry * 100) * li.quantity,
  }));
  const amountKurus = lineItems.reduce((s, li) => s + li.priceKurus, 0);
  // Upper bound keeps the total within Postgres int4 (amount_kurus column) and
  // turns an otherwise opaque "integer out of range" 500 into a clear 400.
  const MAX_AMOUNT_KURUS = 2_000_000_00; // ₺2.000.000
  if (amountKurus <= 0 || amountKurus > MAX_AMOUNT_KURUS) {
    return NextResponse.json(
      { error: "Tutar geçersiz (0 ile ₺2.000.000 arasında olmalı)." },
      { status: 400 }
    );
  }

  const reference = buildDraftReference();
  const isCard = input.paymentMethod === "card";
  // Generous, informational deadline for manual havale orders (the customer is
  // mid-negotiation on WhatsApp). No bullmq expire/reminder job is scheduled —
  // admin manages these manually.
  const bankTransferDeadline = isCard
    ? null
    : new Date(Date.now() + 14 * 24 * 3600 * 1000);

  const productTitleSnapshot =
    input.lineItems.length === 1
      ? input.lineItems[0].description
      : `Özel sipariş (${input.lineItems.length} kalem)`;

  // orderType "marketplace" (not "custom"): a manual order is a physical,
  // admin-fulfilled item with NO photo/preview. The "marketplace" promote path
  // skips AI generation entirely and, with no seller assigned, leaves the order
  // in the admin queue. A "custom" draft would instead hit kickOffOrderProcessing
  // and — finding no preview/photo — mark itself failed_generation.
  await db.insert(orderDrafts).values({
    reference,
    userId: user.id,
    email: user.email,
    customerName: user.fullName,
    phone: input.shippingAddress.telefon,
    orderType: "marketplace",
    productTitleSnapshot,
    selectedAddons: lineItems,
    photoKeys: input.photoKeys && input.photoKeys.length > 0 ? input.photoKeys : null,
    shippingAddress: input.shippingAddress,
    amountKurus,
    paymentMethod: input.paymentMethod,
    status: "pending",
    bankTransferDeadline,
    attributionChannel: "whatsapp",
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://figurunica.com";
  return NextResponse.json({
    reference,
    amountKurus,
    payUrl: `${appUrl}/pay/${reference}`,
  });
}
