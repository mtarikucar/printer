import { NextRequest, NextResponse } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, generationAttempts, manufacturers } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { getFileBuffer } from "@/lib/services/storage";
import { normalizeFileUrl } from "@/lib/services/storage";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getManufacturerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify manufacturer is active
  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
    columns: { status: true },
  });
  if (!manufacturer || manufacturer.status !== "active") {
    return NextResponse.json({ error: "Account not active" }, { status: 403 });
  }

  const { id } = await params;

  const order = await db.query.orders.findFirst({
    where: and(
      eq(orders.id, id),
      eq(orders.manufacturerId, session.manufacturerId)
    ),
    columns: { id: true, orderNumber: true },
    with: {
      generationAttempts: {
        where: eq(generationAttempts.status, "succeeded"),
        columns: { outputStlUrl: true },
        orderBy: desc(generationAttempts.createdAt),
        limit: 1,
      },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const stlUrl = normalizeFileUrl(order.generationAttempts[0]?.outputStlUrl ?? null);
  if (!stlUrl) {
    return NextResponse.json({ error: "No STL file available" }, { status: 404 });
  }

  // Extract the file key from the URL (part after /api/files/)
  const fileKeyMatch = stlUrl.match(/\/api\/files\/(.+)$/);
  if (!fileKeyMatch) {
    return NextResponse.json(
      { error: "Invalid file reference" },
      { status: 500 }
    );
  }

  const fileKey = decodeURIComponent(fileKeyMatch[1]);

  try {
    const buffer = await getFileBuffer(fileKey);

    const uint8 = new Uint8Array(buffer);

    return new NextResponse(uint8, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${order.orderNumber}.stl"`,
        "Content-Length": String(buffer.length),
      },
    });
  } catch (error) {
    console.error("STL download failed:", error);
    return NextResponse.json(
      { error: "File not found" },
      { status: 404 }
    );
  }
}
