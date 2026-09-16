import { NextRequest, NextResponse } from "next/server";
import {
  authorizeAdminProduct,
  handleProductSpecPatch,
} from "@/lib/services/product-spec-handlers";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await authorizeAdminProduct(id);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    return handleProductSpecPatch(request, id);
  } catch (e) {
    return handleRouteFailure(e, "PATCH /api/admin/products/[id]/spec", ADMIN_ACTION_FAILED_ERROR);
  }
}
