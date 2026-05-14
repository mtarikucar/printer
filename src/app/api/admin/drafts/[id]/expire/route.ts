import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { expireDraft } from "@/lib/services/order-draft";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  try {
    await expireDraft(id);
  } catch (err) {
    console.error("Admin expire draft failed:", err);
    return NextResponse.json({ error: "Failed to expire draft" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
