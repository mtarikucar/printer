import { nanoid } from "nanoid";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { giftCards } from "@/lib/db/schema";
import { sendEmail } from "@/lib/services/email";
import type { Locale } from "@/lib/i18n/types";

export function generateGiftCardCode(): string {
  const part1 = nanoid(4).toUpperCase();
  const part2 = nanoid(4).toUpperCase();
  return `GC-${part1}-${part2}`;
}

interface PurchaseParams {
  theme: string;
  amountKurus: number;
  buyerUserId: string;
  buyerEmail: string;
  buyerName: string;
  recipientEmail?: string;
  recipientName?: string;
  recipientMessage?: string;
}

export async function purchaseGiftCard(params: PurchaseParams) {
  const code = generateGiftCardCode();
  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  const [card] = await db
    .insert(giftCards)
    .values({
      code,
      theme: params.theme as "ramazan" | "dogum_gunu" | "yeni_yil" | "sevgililer_gunu" | "genel",
      amountKurus: params.amountKurus,
      balanceKurus: params.amountKurus,
      status: "pending_payment",
      buyerUserId: params.buyerUserId,
      buyerEmail: params.buyerEmail,
      buyerName: params.buyerName,
      recipientEmail: params.recipientEmail || null,
      recipientName: params.recipientName || null,
      recipientMessage: params.recipientMessage || null,
      expiresAt,
    })
    .returning();

  // Build WhatsApp message
  const priceFormatted = `₺${(params.amountKurus / 100).toLocaleString("tr-TR")}`;
  const message = [
    `Hediye Kartı Siparişi`,
    `Kod: ${code}`,
    `Tutar: ${priceFormatted}`,
    `Alıcı: ${params.buyerName}`,
    params.recipientEmail ? `Gönderilecek: ${params.recipientName || ""} (${params.recipientEmail})` : `Kendisi için`,
  ].join("\n");

  const phone = process.env.WHATSAPP_PHONE;
  const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;

  return { card, whatsappUrl };
}

export async function confirmGiftCard(id: string, locale: Locale) {
  const [updated] = await db
    .update(giftCards)
    .set({
      status: "active",
      paidAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(giftCards.id, id), eq(giftCards.status, "pending_payment")))
    .returning();

  if (!updated) {
    throw new Error("Gift card not found or already confirmed");
  }

  // Send email to recipient (or buyer if no recipient)
  const recipientEmail = updated.recipientEmail || updated.buyerEmail;
  if (recipientEmail) {
    await sendEmail({
      type: "gift_card_received",
      to: recipientEmail,
      orderNumber: updated.code,
      customerName: updated.recipientName || updated.buyerName,
      giftCardCode: updated.code,
      giftCardAmount: updated.amountKurus,
      giftCardMessage: updated.recipientMessage || undefined,
      senderName: updated.buyerName,
      locale,
    });

    await db
      .update(giftCards)
      .set({ emailSent: true, updatedAt: new Date() })
      .where(eq(giftCards.id, id));
  }
}

export async function validateGiftCard(code: string) {
  const card = await db.query.giftCards.findFirst({
    where: eq(giftCards.code, code.toUpperCase()),
  });

  if (!card) return { valid: false, error: "not_found" as const };
  if (card.status === "pending_payment") return { valid: false, error: "not_active" as const };
  if (card.status === "fully_used") return { valid: false, error: "fully_used" as const };
  if (card.status === "expired" || card.expiresAt < new Date()) return { valid: false, error: "expired" as const };

  return {
    valid: true,
    card: {
      id: card.id,
      code: card.code,
      balanceKurus: card.balanceKurus,
      theme: card.theme,
    },
  };
}
