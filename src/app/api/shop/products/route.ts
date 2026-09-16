import { NextRequest, NextResponse } from "next/server";
import { queryShopProducts } from "@/lib/services/shop-query";
import { handleRouteFailure, CUSTOMER_READ_FAILED_ERROR } from "@/lib/api/route-error";

export const runtime = "nodejs";

// Load-more / filtered catalogue feed for the storefront grid.
async function handleGET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const num = (v: string | null) => {
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const { items, hasMore } = await queryShopProducts({
    category: sp.get("category"),
    sort: sp.get("sort"),
    q: sp.get("q"),
    material: sp.get("material"),
    priceMin: num(sp.get("priceMin")),
    priceMax: num(sp.get("priceMax")),
    offset: Math.max(0, Number(sp.get("offset")) || 0),
  });
  return NextResponse.json({ items, hasMore });
}

/**
 * Beklenmeyen hata = GÖVDESİ OLAN cevap. İş yukarıdaki `handleGET` içinde
 * yapılır; buradaki tek yakalama, Next'in sıfır baytlık 500'ü yerine ekranın
 * basabileceği TÜRKÇE bir cümle döndürür (gerekçe: src/lib/api/route-error.ts).
 */
export async function GET(req: NextRequest) {
  try {
    return await handleGET(req);
  } catch (e) {
    return handleRouteFailure(e, "GET /api/shop/products", CUSTOMER_READ_FAILED_ERROR);
  }
}
