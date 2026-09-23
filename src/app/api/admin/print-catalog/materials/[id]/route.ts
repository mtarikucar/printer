import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { ADMIN_ACTION_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { catalogOutcome, updateMaterial } from "@/lib/services/quote-catalog-admin";
import { materialPatchSchema } from "@/lib/validators/print-catalog";
import {
  catalogRefusal,
  invalidBody,
  NOT_FOUND_RESPONSE,
  parseCatalogId,
  revalidateCatalogSurfaces,
} from "../../_shared";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const params = await context.params;
    const id = parseCatalogId(params.id);
    if (!id) return NOT_FOUND_RESPONSE();

    const parsed = materialPatchSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return invalidBody(parsed.error);

    const outcome = await catalogOutcome(() =>
      updateMaterial(id, parsed.data, a.session.user.email)
    );
    if (!outcome.ok) return catalogRefusal(outcome);

    revalidateCatalogSurfaces();
    return NextResponse.json({ success: true, material: outcome.value });
  } catch (e) {
    return handleRouteFailure(
      e,
      "PATCH /api/admin/print-catalog/materials/[id]",
      ADMIN_ACTION_FAILED_ERROR
    );
  }
}
