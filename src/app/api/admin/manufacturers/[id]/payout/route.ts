import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createPayoutForManufacturer } from "@/lib/services/payouts";

// Admin creates a payout batch from a manufacturer's not-yet-batched earnings.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { id } = await params;

  const result = await createPayoutForManufacturer(id, a.session.user.email);
  if (!result) {
    return NextResponse.json({ error: "No pending earnings to pay out" }, { status: 400 });
  }
  return NextResponse.json({ success: true, ...result });
}
