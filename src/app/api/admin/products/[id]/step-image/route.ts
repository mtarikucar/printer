import { NextRequest, NextResponse } from "next/server";
import {
  authorizeAdminProduct,
  handleStepImagePost,
} from "@/lib/services/product-spec-handlers";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await authorizeAdminProduct(id);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    return handleStepImagePost(request);
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/products/[id]/step-image", ADMIN_ACTION_FAILED_ERROR);
  }
}
