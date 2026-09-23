import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  ADMIN_ACTION_FAILED_ERROR,
  ADMIN_READ_FAILED_ERROR,
  handleRouteFailure,
} from "@/lib/api/route-error";
import {
  catalogOutcome,
  readPricingSettings,
  updatePricingSettings,
} from "@/lib/services/quote-catalog-admin";
import { pricingSettingsUpdateSchema } from "@/lib/validators/print-catalog";
import { catalogRefusal, invalidBody, revalidateCatalogSurfaces } from "../_shared";

/**
 * Tek satırlık fiyat/teslim politikası (`quote_pricing_settings`, id = 1).
 *
 * Kimlik segmenti YOK, çünkü ortada bir kayıt kümesi değil TEK bir politika
 * var (kutu fiyatları ucunun deseni). PUT yine de `expectedUpdatedAt` ister:
 * tek satır, iki sekmede açık olduğunda da tek satırdır.
 */
export async function GET() {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const outcome = await catalogOutcome(() => readPricingSettings());
    if (!outcome.ok) return catalogRefusal(outcome);
    return NextResponse.json({ settings: outcome.value });
  } catch (e) {
    return handleRouteFailure(
      e,
      "GET /api/admin/print-catalog/settings",
      ADMIN_READ_FAILED_ERROR
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const parsed = pricingSettingsUpdateSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return invalidBody(parsed.error);

    const outcome = await catalogOutcome(() =>
      updatePricingSettings(
        parsed.data.settings,
        parsed.data.expectedUpdatedAt,
        a.session.user.email
      )
    );
    if (!outcome.ok) return catalogRefusal(outcome);

    revalidateCatalogSurfaces();
    return NextResponse.json({ success: true, settings: outcome.value });
  } catch (e) {
    return handleRouteFailure(
      e,
      "PUT /api/admin/print-catalog/settings",
      ADMIN_ACTION_FAILED_ERROR
    );
  }
}
