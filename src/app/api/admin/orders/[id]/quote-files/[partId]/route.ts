import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { fileDownloadResponse, inlineImageResponse } from "@/lib/services/model-file-download";
import { loadOrderQuoteParts } from "@/lib/services/quote-order";
import { handleRouteFailure, ADMIN_READ_FAILED_ERROR } from "@/lib/api/route-error";

/**
 * Teklif parçasının yan dosyaları (teknik çizim + küçük resim), admin için.
 *
 * Üretici ucunun (`/api/manufacturer/orders/[id]/quote-files/[partId]`)
 * ikizidir; ayrı durmasının tek sebebi KAPIDIR: burada oturum admin'dir ve
 * sipariş atanmamış olsa da belge okunabilir — admin siparişi üreticiye
 * vermeden önce çizimi görmek zorunda.
 *
 * Liste ÖDENEN anlık görüntüdendir: teklifin canlı kopyası sonradan
 * değişse bile denetlenen belge, paranın karşılığı olan belgedir.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; partId: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const { id, partId } = await params;
    const quote = await loadOrderQuoteParts(id);
    const part = quote?.parts.find((p) => p.partId === partId);
    if (!part) {
      return Response.json({ error: "Parça bulunamadı" }, { status: 404 });
    }

    if (new URL(request.url).searchParams.get("kind") === "thumbnail") {
      if (!part.thumbnailKey) {
        return Response.json({ error: "Bu parçanın görseli yok" }, { status: 404 });
      }
      return inlineImageResponse(part.thumbnailKey);
    }

    if (!part.drawingKey) {
      return Response.json({ error: "Bu parçanın teknik çizimi yok" }, { status: 404 });
    }
    const order = await db.query.orders.findFirst({
      where: eq(orders.id, id),
      columns: { orderNumber: true },
    });
    return fileDownloadResponse(
      {
        key: part.drawingKey,
        name: `${order?.orderNumber ?? quote!.quoteNumber}-${part.drawingName ?? `${part.name}.pdf`}`,
      },
      "application/pdf"
    );
  } catch (e) {
    return handleRouteFailure(
      e,
      "GET /api/admin/orders/[id]/quote-files/[partId]",
      ADMIN_READ_FAILED_ERROR
    );
  }
}
