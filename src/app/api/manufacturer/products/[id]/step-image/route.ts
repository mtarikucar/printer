import { NextRequest, NextResponse } from "next/server";
import {
  authorizeSellerProduct,
  handleStepImagePost,
} from "@/lib/services/product-spec-handlers";
import { handleRouteFailure, PARTNER_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await authorizeSellerProduct(id);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    return handleStepImagePost(request);
  } catch (e) {
    return handleRouteFailure(e, "POST /api/manufacturer/products/[id]/step-image", PARTNER_ACTION_FAILED_ERROR);
  }
}
