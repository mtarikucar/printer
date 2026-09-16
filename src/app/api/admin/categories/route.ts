import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createCategory, getCategoryTree } from "@/lib/services/categories";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR, ADMIN_READ_FAILED_ERROR } from "@/lib/api/route-error";

// Admin category-tree management. Reads reuse the public tree; this route adds
// nodes. Mutations on an existing node live under [id].
export async function GET() {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const tree = await getCategoryTree();
    return NextResponse.json({ tree });
  } catch (e) {
    return handleRouteFailure(e, "GET /api/admin/categories", ADMIN_READ_FAILED_ERROR);
  }
}

export async function POST(request: NextRequest) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    try {
      const body = await request.json();
      const name = typeof body?.name === "string" ? body.name : "";
      const parentId =
        typeof body?.parentId === "string" && body.parentId ? body.parentId : null;
      const created = await createCategory({ parentId, name });
      return NextResponse.json({ category: created });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "error";
      const status = msg === "EMPTY_NAME" || msg === "PARENT_NOT_FOUND" ? 400 : 500;
      return NextResponse.json({ error: msg }, { status });
    }
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/categories", ADMIN_ACTION_FAILED_ERROR);
  }
}
