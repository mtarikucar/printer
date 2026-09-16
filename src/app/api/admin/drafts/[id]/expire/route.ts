import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { expireDraft } from "@/lib/services/order-draft";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const { id } = await params;
    try {
      await expireDraft(id);
    } catch (err) {
      console.error("Admin expire draft failed:", err);
      return NextResponse.json({ error: "Taslağın süresi dolduruldu olarak işaretlenemedi. Sayfayı yenileyip tekrar deneyin." }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/drafts/[id]/expire", ADMIN_ACTION_FAILED_ERROR);
  }
}
