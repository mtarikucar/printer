import { NextRequest, NextResponse } from "next/server";
import { extname } from "path";
import { getFileBuffer, isPublicUnsignedKey } from "@/lib/services/storage";
import { handleRouteFailure, CUSTOMER_READ_FAILED_ERROR } from "@/lib/api/route-error";

/**
 * Public, unsigned, immutable delivery for storefront product photos.
 *
 * `/api/files/*` requires a signature in production (FILES_REQUIRE_SIGNATURE=1)
 * and is robots-disallowed, which made every product image unreachable for
 * crawlers. This route is the narrow carve-out: it serves ONLY keys that
 * `isPublicUnsignedKey` accepts (currently the `products/` prefix), so customer
 * photos, meshes, chat attachments and receipts are untouched and still signed.
 *
 * Filenames are nanoids written once by the upload pipeline and never mutated,
 * so the response is safely immutable for a year.
 */

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

async function handleGET(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string[] }> }
) {
  const { key: segments } = await params;
  const relativePath = `products/${segments.join("/")}`;

  // Defence in depth: the route is already scoped to /media/products, but a
  // traversal segment could still climb out of it.
  if (!isPublicUnsignedKey(relativePath)) {
    return NextResponse.json({ error: "Görsel bulunamadı." }, { status: 404 });
  }

  const ext = extname(relativePath).toLowerCase();
  const contentType = MIME_TYPES[ext];
  // Only image types are public here. A .glb/.stl under products/ must not leak.
  if (!contentType) {
    return NextResponse.json({ error: "Görsel bulunamadı." }, { status: 404 });
  }

  // `getFileBuffer` throws (ENOENT, or `assertSafePath` rejecting a traversal
  // that survives the isPublicUnsignedKey check) rather than returning null —
  // both cases are "not found" from this route's point of view.
  let buffer: Buffer;
  try {
    buffer = await getFileBuffer(relativePath);
  } catch {
    return NextResponse.json({ error: "Görsel bulunamadı." }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/**
 * Beklenmeyen hata = GÖVDESİ OLAN cevap.
 *
 * NEDEN BU ROTADA DA: bir rota işleyicisi src/app/api ALTINDA olmak zorunda
 * değil ve kural klasörün değil, UCUN kuralıdır. Burada `await params` ile
 * anahtar kapısı her türlü korumanın DIŞINDAydı: fırladığında Next'in sıfır
 * baytlık 500'ü dönüyordu — üstelik mağazanın herkese açık ürün görseli
 * yolunda. Şimdi en dış yakalama TÜRKÇE bir gövde döndürür
 * (bkz. src/lib/api/route-error.ts).
 */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ key: string[] }> }
) {
  try {
    return await handleGET(request, ctx);
  } catch (e) {
    return handleRouteFailure(e, "GET /media/products/[...key]", CUSTOMER_READ_FAILED_ERROR);
  }
}
