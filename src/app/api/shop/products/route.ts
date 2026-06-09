import { NextRequest, NextResponse } from "next/server";
import { queryShopProducts } from "@/lib/services/shop-query";

export const runtime = "nodejs";

// Load-more / filtered catalogue feed for the storefront grid.
export async function GET(req: NextRequest) {
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
