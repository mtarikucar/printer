import { NextRequest } from "next/server";
import { manufacturerOrderOrError } from "@/lib/services/manufacturer-order-access";
import { fileDownloadResponse, inlineImageResponse } from "@/lib/services/model-file-download";
import { loadOrderQuoteParts } from "@/lib/services/quote-order";
import { handleRouteFailure, PARTNER_READ_FAILED_ERROR } from "@/lib/api/route-error";

/**
 * Teklif parçasının YAN dosyaları: teknik çizim (varsayılan) ve küçük resim.
 *
 * Neden ayrı bir uç: çizim PDF'i `order_model_files`a giremez (orada yalnız
 * `stl`/`glb` var) ve küçük resmi imzalı depo URL'iyle vermek, bağlantıyı
 * eline geçiren herkese açmak olurdu. İkisi de siparişin ATANMIŞ atölyesine
 * bağlıdır: kapı `manufacturerOrderOrError`, yani oturum + aktif hesap + bu
 * siparişin sahibi olmak.
 *
 * Parça listesi ÖDENEN anlık görüntüdendir (`quote_checkouts.parts_snapshot`):
 * müşteri ödemeden sonra teklifin canlı kopyasındaki çizimi değiştirse bile
 * tezgâha giden belge değişmez.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; partId: string }> }
) {
  try {
    const { id, partId } = await params;

    const gate = await manufacturerOrderOrError(id);
    if (!gate.ok) return gate.response;

    const quote = await loadOrderQuoteParts(id);
    const part = quote?.parts.find((p) => p.partId === partId);
    if (!part) {
      return Response.json({ error: "Parça bulunamadı" }, { status: 404 });
    }

    const wantsThumbnail = new URL(request.url).searchParams.get("kind") === "thumbnail";
    if (wantsThumbnail) {
      if (!part.thumbnailKey) {
        return Response.json({ error: "Bu parçanın görseli yok" }, { status: 404 });
      }
      // Küçük resim SATIR İÇİ döner (indirme değil): parça listesindeki
      // `<img>` etiketi onu gösteriyor. `attachment` yollasaydık tarayıcıya
      // göre resim yerine indirme çıkardı.
      return inlineImageResponse(part.thumbnailKey);
    }

    if (!part.drawingKey) {
      return Response.json({ error: "Bu parçanın teknik çizimi yok" }, { status: 404 });
    }
    return fileDownloadResponse(
      {
        key: part.drawingKey,
        // Sipariş numarası adın İÇİNDE: atölye onlarca çizimi tek klasöre
        // indiriyor ve "cizim.pdf" hangi işin olduğunu söylemez.
        name: `${gate.order.orderNumber}-${part.drawingName ?? `${part.name}.pdf`}`,
      },
      "application/pdf"
    );
  } catch (e) {
    return handleRouteFailure(
      e,
      "GET /api/manufacturer/orders/[id]/quote-files/[partId]",
      PARTNER_READ_FAILED_ERROR
    );
  }
}
