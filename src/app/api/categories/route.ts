import { NextResponse } from "next/server";
import { getCategoryTree } from "@/lib/services/categories";
import { handleRouteFailure, CUSTOMER_READ_FAILED_ERROR } from "@/lib/api/route-error";

// Public category tree — consumed by the storefront ribbon/nav, the homepage
// shelves, and the product-form category pickers. Dynamic so admin edits show
// up immediately (the tree is small; no caching needed).
export const dynamic = "force-dynamic";

async function handleGET() {
  const tree = await getCategoryTree();
  return NextResponse.json({ tree });
}

/**
 * Beklenmeyen hata = GÖVDESİ OLAN cevap. İş yukarıdaki `handleGET` içinde
 * yapılır; buradaki tek yakalama, Next'in sıfır baytlık 500'ü yerine ekranın
 * basabileceği TÜRKÇE bir cümle döndürür (gerekçe: src/lib/api/route-error.ts).
 */
export async function GET() {
  try {
    return await handleGET();
  } catch (e) {
    return handleRouteFailure(e, "GET /api/categories", CUSTOMER_READ_FAILED_ERROR);
  }
}
