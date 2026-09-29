import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  ADMIN_ACTION_FAILED_ERROR,
  ADMIN_READ_FAILED_ERROR,
  handleRouteFailure,
} from "@/lib/api/route-error";
import {
  catalogOutcome,
  createMaterial,
  listMaterialsForAdmin,
} from "@/lib/services/quote-catalog-admin";
import { materialCreateSchema } from "@/lib/validators/print-catalog";
import { catalogRefusal, invalidBody, revalidateCatalogSurfaces } from "../_shared";

/**
 * Malzemeler. Bağlı teknoloji ve anahtar yalnız OLUŞTURMADA verilir: ikisi de
 * açık tekliflerin parçalarının baktığı adrestir (`quote_parts.material_key` +
 * teknoloji eşlemesi), sonradan değiştirmek kataloğu değil geçmişi bozar.
 */
export async function GET() {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    // YALNIZ kendi dilimi (bkz. `technologies/route.ts` notu).
    const outcome = await catalogOutcome(() => listMaterialsForAdmin());
    if (!outcome.ok) return catalogRefusal(outcome);
    return NextResponse.json({ materials: outcome.value });
  } catch (e) {
    return handleRouteFailure(
      e,
      "GET /api/admin/print-catalog/materials",
      ADMIN_READ_FAILED_ERROR
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const parsed = materialCreateSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return invalidBody(parsed.error);

    const outcome = await catalogOutcome(() => createMaterial(parsed.data, a.session.user.email));
    if (!outcome.ok) return catalogRefusal(outcome);

    revalidateCatalogSurfaces();
    return NextResponse.json({ success: true, material: outcome.value }, { status: 201 });
  } catch (e) {
    return handleRouteFailure(
      e,
      "POST /api/admin/print-catalog/materials",
      ADMIN_ACTION_FAILED_ERROR
    );
  }
}
