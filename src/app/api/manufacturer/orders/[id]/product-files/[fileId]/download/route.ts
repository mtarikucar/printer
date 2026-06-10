import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, manufacturers, productFiles, orderItems } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { getFileBuffer } from "@/lib/services/storage";

// Download one printable part (STL/OBJ) of a marketplace order's product, for
// the assigned manufacturer. The file must belong to a product this order
// covers (single productId OR a cart sub-order's orderItems). Mirrors
// download-upload's auth + streaming.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> }
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

  const { id, fileId } = await params;
  const order = await db.query.orders.findFirst({
    where: and(eq(orders.id, id), eq(orders.manufacturerId, session.manufacturerId)),
    columns: { id: true, orderNumber: true, productId: true },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Every product this order covers (single buy-now, or cart sub-order lines).
  const productIds = new Set<string>();
  if (order.productId) productIds.add(order.productId);
  const items = await db
    .select({ productId: orderItems.productId })
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id));
  for (const it of items) if (it.productId) productIds.add(it.productId);

  const file = await db.query.productFiles.findFirst({
    where: eq(productFiles.id, fileId),
    columns: {
      storageKey: true,
      sourceFormat: true,
      partName: true,
      fileName: true,
      productId: true,
    },
  });
  if (!file || !productIds.has(file.productId)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  try {
    const buffer = await getFileBuffer(file.storageKey);
    const base = (file.partName || file.fileName || order.orderNumber).replace(
      /[^a-zA-Z0-9._-]/g,
      "_"
    );
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${base}.${file.sourceFormat}"`,
        "Content-Length": String(buffer.length),
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
