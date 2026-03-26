import { NextRequest, NextResponse } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, generationAttempts, manufacturers } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { getFileBuffer } from "@/lib/services/storage";

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
        columns: { outputGlbUrl: true },
        orderBy: desc(generationAttempts.createdAt),
        limit: 1,
      },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const glbUrl = order.generationAttempts[0]?.outputGlbUrl;
  if (!glbUrl) {
    return NextResponse.json({ error: "No GLB file available" }, { status: 404 });
  }

  // Extract the file key from the URL (part after /api/files/)
  const fileKeyMatch = glbUrl.match(/\/api\/files\/(.+)$/);
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
        "Content-Type": "model/gltf-binary",
        "Content-Disposition": `attachment; filename="${order.orderNumber}.glb"`,
        "Content-Length": String(buffer.length),
      },
    });
  } catch (error) {
    console.error("GLB download failed:", error);
    return NextResponse.json(
      { error: "File not found" },
      { status: 404 }
    );
  }
}
