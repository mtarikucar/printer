import { NextRequest, NextResponse } from "next/server";
import {
  authorizeSellerProduct,
  handleProductSpecPatch,
} from "@/lib/services/product-spec-handlers";
import { handleRouteFailure, PARTNER_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await authorizeSellerProduct(id);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    return handleProductSpecPatch(request, id);
  } catch (e) {
    return handleRouteFailure(e, "PATCH /api/manufacturer/products/[id]/spec", PARTNER_ACTION_FAILED_ERROR);
  }
}
