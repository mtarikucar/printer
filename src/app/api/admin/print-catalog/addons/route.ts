import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  ADMIN_ACTION_FAILED_ERROR,
  ADMIN_READ_FAILED_ERROR,
  handleRouteFailure,
} from "@/lib/api/route-error";
import {
  catalogOutcome,
  createAddon,
  listCatalogForAdmin,
} from "@/lib/services/quote-catalog-admin";
import { addonCreateSchema } from "@/lib/validators/print-catalog";
import { catalogRefusal, invalidBody, revalidateCatalogSurfaces } from "../_shared";

/**
 * Ek hizmetler (sertifika, ölçüm raporu, …). Teklif DÜZEYİNDEDİR: fiyatı
 * `priceType` belirler — sabit, parça başına ya da adet başına.
 */
export async function GET() {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const outcome = await catalogOutcome(() => listCatalogForAdmin());
    if (!outcome.ok) return catalogRefusal(outcome);
    return NextResponse.json({ addons: outcome.value.addons });
  } catch (e) {
    return handleRouteFailure(e, "GET /api/admin/print-catalog/addons", ADMIN_READ_FAILED_ERROR);
  }
}

export async function POST(request: NextRequest) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const parsed = addonCreateSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return invalidBody(parsed.error);

    const outcome = await catalogOutcome(() => createAddon(parsed.data, a.session.user.email));
    if (!outcome.ok) return catalogRefusal(outcome);

    revalidateCatalogSurfaces();
    return NextResponse.json({ success: true, addon: outcome.value }, { status: 201 });
  } catch (e) {
    return handleRouteFailure(
      e,
      "POST /api/admin/print-catalog/addons",
      ADMIN_ACTION_FAILED_ERROR
    );
  }
}
