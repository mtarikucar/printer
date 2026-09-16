import { NextRequest, NextResponse } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, generationAttempts, manufacturers } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { getFileBuffer } from "@/lib/services/storage";
import { normalizeFileUrl } from "@/lib/services/storage";
import { handleRouteFailure, PARTNER_READ_FAILED_ERROR } from "@/lib/api/route-error";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getManufacturerSession();
    if (!session) {
      return NextResponse.json({ error: "Oturumunuz doğrulanamadı. Yeniden giriş yapın." }, { status: 401 });
    }

    // Verify manufacturer is active
    const manufacturer = await db.query.manufacturers.findFirst({
      where: eq(manufacturers.id, session.manufacturerId),
      columns: { status: true },
    });
    if (!manufacturer || manufacturer.status !== "active") {
      return NextResponse.json({ error: "Hesabınız şu anda aktif değil; dosya indirilemez." }, { status: 403 });
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
          columns: { outputObjUrl: true },
          orderBy: desc(generationAttempts.createdAt),
          limit: 1,
        },
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Sipariş bulunamadı ya da bu siparişe yetkiniz yok." }, { status: 404 });
    }

    const objUrl = normalizeFileUrl(order.generationAttempts[0]?.outputObjUrl ?? null);
    if (!objUrl) {
      return NextResponse.json({ error: "Bu siparişin OBJ dosyası yok." }, { status: 404 });
    }

    // Extract the file key from the URL (part after /api/files/)
    const fileKeyMatch = objUrl.match(/\/api\/files\/(.+)$/);
    if (!fileKeyMatch) {
      return NextResponse.json(
        { error: "OBJ dosyasının adresi geçersiz. Bu bir sistem hatasıdır; yöneticiye bildirin, dosya yeniden yüklenmeli." },
        { status: 500 }
      );
    }

    // Strip any ?exp=&sig= the signed URL carries before resolving the file key.
    const fileKey = decodeURIComponent(fileKeyMatch[1].split("?")[0]);

    try {
      const buffer = await getFileBuffer(fileKey);

      const uint8 = new Uint8Array(buffer);

      return new NextResponse(uint8, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${order.orderNumber}.obj"`,
          "Content-Length": String(buffer.length),
        },
      });
    } catch (error) {
      console.error("OBJ download failed:", error);
      return NextResponse.json(
        { error: "Model dosyası şu anda bulunamadı. Birkaç dakika sonra tekrar deneyin; sorun sürerse yöneticiye bildirin." },
        { status: 404 }
      );
    }
  } catch (e) {
    return handleRouteFailure(e, "GET /api/manufacturer/orders/[id]/download-obj", PARTNER_READ_FAILED_ERROR);
  }
}
