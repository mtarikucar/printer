import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { expireDraft } from "@/lib/services/order-draft";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;

  const { id } = await params;
  try {
    await expireDraft(id);
  } catch (err) {
    console.error("Admin expire draft failed:", err);
    return NextResponse.json({ error: "Failed to expire draft" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
