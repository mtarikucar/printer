import { NextRequest, NextResponse } from "next/server";
import {
  authorizeAdminProduct,
  handleStepImagePost,
} from "@/lib/services/product-spec-handlers";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authorizeAdminProduct(id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return handleStepImagePost(request);
}
