import { NextRequest, NextResponse } from "next/server";
import {
  authorizeSellerProduct,
  handleProductFilePost,
  handleProductFileDelete,
} from "@/lib/services/product-spec-handlers";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authorizeSellerProduct(id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return handleProductFilePost(request, id);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authorizeSellerProduct(id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return handleProductFileDelete(request, id);
}
