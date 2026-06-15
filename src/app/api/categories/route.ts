import { NextResponse } from "next/server";
import { getCategoryTree } from "@/lib/services/categories";

// Public category tree — consumed by the storefront ribbon/nav, the homepage
// shelves, and the product-form category pickers. Dynamic so admin edits show
// up immediately (the tree is small; no caching needed).
export const dynamic = "force-dynamic";

export async function GET() {
  const tree = await getCategoryTree();
  return NextResponse.json({ tree });
}
