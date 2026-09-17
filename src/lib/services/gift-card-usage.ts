import { and, countDistinct, eq, isNull, sql } from "drizzle-orm";
import { giftCardRedemptions, orders } from "@/lib/db/schema";
import type { MoneyTx } from "./money-partner-lock";

/** One live checkout use, even after its draft-anchored child is refunded.
 * Checkout callers must hold the card lock while enforcing maxRedemptions.
 */
export async function countLiveGiftCardUses(
  reader: Pick<MoneyTx, "select">,
  giftCardId: string,
): Promise<number> {
  const [row] = await reader.select({
    uses: countDistinct(sql`coalesce(
      'draft:' || coalesce(${giftCardRedemptions.draftId}, ${orders.draftId})::text,
      'order:' || ${giftCardRedemptions.orderId}::text,
      'redemption:' || ${giftCardRedemptions.id}::text
    )`),
  }).from(giftCardRedemptions)
    .leftJoin(orders, eq(orders.id, giftCardRedemptions.orderId))
    .where(and(eq(giftCardRedemptions.giftCardId, giftCardId), isNull(giftCardRedemptions.refundedAt)));
  return row.uses;
}
