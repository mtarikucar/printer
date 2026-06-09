import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orders, uploadedModels } from "@/lib/db/schema";
import { getFileBuffer } from "@/lib/services/storage";

// Polish: admin download of a customer's original uploaded STL/OBJ for an
// upload-type order (so admin can inspect/forward the model).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;

  const { id } = await params;
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    columns: { orderNumber: true, uploadedModelId: true },
  });
  if (!order?.uploadedModelId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const model = await db.query.uploadedModels.findFirst({
    where: eq(uploadedModels.id, order.uploadedModelId),
    columns: { sourceKey: true, sourceFormat: true },
  });
  if (!model) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
    const buffer = await getFileBuffer(model.sourceKey);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${order.orderNumber}.${model.sourceFormat}"`,
        "Content-Length": String(buffer.length),
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
