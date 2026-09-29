import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  ADMIN_ACTION_FAILED_ERROR,
  ADMIN_READ_FAILED_ERROR,
  handleRouteFailure,
} from "@/lib/api/route-error";
import {
  catalogOutcome,
  createFinish,
  listFinishesForAdmin,
} from "@/lib/services/quote-catalog-admin";
import { finishCreateSchema } from "@/lib/validators/print-catalog";
import { catalogRefusal, invalidBody, revalidateCatalogSurfaces } from "../_shared";

/**
 * Yüzey işlemleri. `technologyId = null` "her teknolojiye uygun" demektir.
 *
 * `requiresManual` bir FİYAT kararıdır, bir etiket değil: işaretli yüzey
 * seçilen parça anlık fiyat ALMAZ, manuel teklife düşer (`quote-dfm` ·
 * `finish_manual`). `costLineKind` ise paranın hangi partnere gideceğini
 * belirler (üretim / boyama payı).
 */
export async function GET() {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    // YALNIZ kendi dilimi (bkz. `technologies/route.ts` notu).
    const outcome = await catalogOutcome(() => listFinishesForAdmin());
    if (!outcome.ok) return catalogRefusal(outcome);
    return NextResponse.json({ finishes: outcome.value });
  } catch (e) {
    return handleRouteFailure(
      e,
      "GET /api/admin/print-catalog/finishes",
      ADMIN_READ_FAILED_ERROR
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const parsed = finishCreateSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return invalidBody(parsed.error);

    const outcome = await catalogOutcome(() => createFinish(parsed.data, a.session.user.email));
    if (!outcome.ok) return catalogRefusal(outcome);

    revalidateCatalogSurfaces();
    return NextResponse.json({ success: true, finish: outcome.value }, { status: 201 });
  } catch (e) {
    return handleRouteFailure(
      e,
      "POST /api/admin/print-catalog/finishes",
      ADMIN_ACTION_FAILED_ERROR
    );
  }
}
