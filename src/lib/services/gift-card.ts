import { nanoid } from "nanoid";
import { eq, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { giftCards, giftCardRedemptions } from "@/lib/db/schema";

export function generateGiftCardCode(): string {
  const part1 = nanoid(4).toUpperCase();
  const part2 = nanoid(4).toUpperCase();
  return `GC-${part1}-${part2}`;
}

interface CreateGiftCardParams {
  code?: string;
  amountKurus: number;
  note?: string;
  recipientName?: string;
  recipientEmail?: string;
  expirationDays?: number;
  maxRedemptions?: number;
}

export async function createGiftCard(params: CreateGiftCardParams) {
  const code = params.code ? params.code.toUpperCase() : generateGiftCardCode();
  const expiresAt = new Date();
  if (params.expirationDays === 0) {
    // No expiration — set far future
    expiresAt.setFullYear(expiresAt.getFullYear() + 100);
  } else {
    const days = params.expirationDays && params.expirationDays > 0 ? params.expirationDays : 365;
    expiresAt.setDate(expiresAt.getDate() + days);
  }

  const [card] = await db
    .insert(giftCards)
    .values({
      code,
      amountKurus: params.amountKurus,
      balanceKurus: params.amountKurus,
      status: "active",
      paidAt: new Date(),
      note: params.note || null,
      recipientName: params.recipientName || null,
      recipientEmail: params.recipientEmail || null,
      maxRedemptions: params.maxRedemptions ?? null,
      expiresAt,
    })
    .returning();

  return { card };
}

export async function validateGiftCard(code: string) {
  const card = await db.query.giftCards.findFirst({
    where: eq(giftCards.code, code.toUpperCase()),
  });

  if (!card) return { valid: false, error: "not_found" as const };
  if (card.status === "pending_payment") return { valid: false, error: "not_active" as const };
  if (card.status === "fully_used") return { valid: false, error: "fully_used" as const };
  if (card.status === "expired" || card.expiresAt < new Date()) return { valid: false, error: "expired" as const };

  // Check redemption limit
  if (card.maxRedemptions !== null) {
    const [result] = await db
      .select({ value: count() })
      .from(giftCardRedemptions)
      .where(eq(giftCardRedemptions.giftCardId, card.id));
    if (result.value >= card.maxRedemptions) {
      return { valid: false, error: "limit_reached" as const };
    }
  }

  return {
    valid: true,
    card: {
      id: card.id,
      code: card.code,
      balanceKurus: card.balanceKurus,
      theme: card.theme,
      maxRedemptions: card.maxRedemptions,
    },
  };
}
