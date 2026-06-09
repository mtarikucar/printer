import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, manufacturers, uploadedModels } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { getFileBuffer } from "@/lib/services/storage";

// Faz 6: download the customer's ORIGINAL uploaded model (STL/OBJ) for an
// upload-type order assigned to this manufacturer. Mirrors download-stl but
// sources the file from uploadedModels.sourceKey (no AI generation involved).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getManufacturerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
    columns: { status: true },
  });
  if (!manufacturer || manufacturer.status !== "active") {
    return NextResponse.json({ error: "Account not active" }, { status: 403 });
  }

  const { id } = await params;
  const order = await db.query.orders.findFirst({
    where: and(eq(orders.id, id), eq(orders.manufacturerId, session.manufacturerId)),
    columns: { id: true, orderNumber: true, uploadedModelId: true },
  });
  if (!order || !order.uploadedModelId) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const model = await db.query.uploadedModels.findFirst({
    where: eq(uploadedModels.id, order.uploadedModelId),
    columns: { sourceKey: true, sourceFormat: true },
  });
  if (!model) {
    return NextResponse.json({ error: "Model not found" }, { status: 404 });
  }

  try {
    const buffer = await getFileBuffer(model.sourceKey);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${order.orderNumber}.${model.sourceFormat}"`,
        "Content-Length": String(buffer.length),
      },
    });
  } catch (error) {
    console.error("upload model download failed:", error);
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
