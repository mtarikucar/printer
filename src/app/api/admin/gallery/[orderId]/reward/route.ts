import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { rewardAndApproveGalleryItem } from "@/lib/services/gallery-review";

const schema = z.object({
  giftCardAmountTL: z.number().int().min(10).max(2000),
  expirationDays: z.number().int().min(7).max(3650).optional(),
  note: z.string().max(200).optional(),
  category: z.string().optional().nullable(),
  tags: z.array(z.string()).optional().nullable(),
  displayName: z.string().optional().nullable(),
});

/**
 * Reward = approve + mint gift card. Admin uses this when a customer's
 * figurine is exceptional enough to warrant a marketing perk.
 *
 * Anti-abuse: amount is capped at ₺2000 per single action; a malicious /
 * compromised admin account can still issue many small rewards, so monitor
 * admin_actions table for unusual frequency.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;

  const { orderId } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid payload" },
      { status: 400 }
    );
  }

  const result = await rewardAndApproveGalleryItem({
    orderId,
    adminEmail: a.session.user.email,
    giftCardAmountKurus: parsed.data.giftCardAmountTL * 100,
    expirationDays: parsed.data.expirationDays,
    note: parsed.data.note,
    category: parsed.data.category ?? null,
    tags: parsed.data.tags ?? null,
    displayName: parsed.data.displayName ?? null,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }
  return NextResponse.json({
    success: true,
    giftCardCode: result.giftCardCode,
  });
}
