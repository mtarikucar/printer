import { NextRequest, NextResponse } from "next/server";
import {
  authorizeAdminProduct,
  handleProductSpecPatch,
} from "@/lib/services/product-spec-handlers";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authorizeAdminProduct(id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return handleProductSpecPatch(request, id);
}
