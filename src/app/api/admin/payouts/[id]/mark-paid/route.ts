import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { markPayoutPaid } from "@/lib/services/payouts";

const schema = z.object({ reference: z.string().trim().max(120).optional() });

// Admin marks a pending payout paid (after sending the bank transfer). Its
// earnings flip to "paid". Idempotent.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { id } = await params;

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  const reference = parsed.success ? parsed.data.reference ?? null : null;

  const ok = await markPayoutPaid(id, reference);
  if (!ok) {
    return NextResponse.json(
      { error: "Payout not found or already paid" },
      { status: 400 }
    );
  }
  return NextResponse.json({ success: true });
}
