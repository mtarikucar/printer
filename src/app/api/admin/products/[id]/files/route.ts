import { NextRequest, NextResponse } from "next/server";
import {
  authorizeAdminProduct,
  handleProductFilePost,
  handleProductFileDelete,
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
    return handleProductFilePost(request, id);
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/products/[id]/files", ADMIN_ACTION_FAILED_ERROR);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await authorizeAdminProduct(id);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    return handleProductFileDelete(request, id);
  } catch (e) {
    return handleRouteFailure(e, "DELETE /api/admin/products/[id]/files", ADMIN_ACTION_FAILED_ERROR);
  }
}
