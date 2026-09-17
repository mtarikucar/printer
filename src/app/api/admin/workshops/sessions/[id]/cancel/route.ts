import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { cancelWorkshopSession } from "@/lib/services/workshop-cancel";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

/** Cancel each participant atomically; retries include all outstanding obligations. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const { id } = await params;
    const res = await cancelWorkshopSession({
      sessionId: id,
      adminEmail: a.session.user.email,
    });
    if (!res.ok) {
      // Makine okunur kod; Türkçesini istemci kurar (katılımcı ucuyla AYNI
      // sözleşme — iki uç arasında iki farklı hata biçimi tutmak, istemcide iki
      // farklı işleme yolu demektir).
      return NextResponse.json(
        { error: res.reason },
        { status: res.reason === "not_found" ? 404 : 409 }
      );
    }

    return NextResponse.json({ ok: true, ...res.report });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/workshops/sessions/[id]/cancel", ADMIN_ACTION_FAILED_ERROR);
  }
}
