import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createVenueSchema } from "@/lib/validators/workshop";
import { createVenueFromRequest } from "@/lib/services/workshop-venue";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

/**
 * Onaylı atölye talebini kalıcı mekana çevirir. Admin, başvuruda olmayan iki
 * alanı burada tamamlar: mekanın adı ve POSTA KODU — sipariş adresi /^\d{5}$/
 * şartı koyuyor, başvuru formu ise posta kodu toplamıyor.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const { id } = await params;
    const locale = getRequestLocale(request);
    const parsed = createVenueSchema(locale).safeParse(
      await request.json().catch(() => ({}))
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Geçersiz istek" },
        { status: 400 }
      );
    }

    const result = await createVenueFromRequest(id, parsed.data, a.session.user.email);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ venueId: result.venueId });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/workshop-requests/[id]/convert-to-venue", ADMIN_ACTION_FAILED_ERROR);
  }
}
