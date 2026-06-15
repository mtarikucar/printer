import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  deleteCategory,
  moveCategory,
  renameCategory,
  reorderCategory,
} from "@/lib/services/categories";

// Mutate one category node: rename, move (reparent), reorder among siblings,
// or delete (cascades to the subtree; products are detached, not deleted).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { id } = await params;

  try {
    const body = await request.json();
    const action = body?.action;
    if (action === "rename") {
      const cat = await renameCategory(id, String(body?.name ?? ""));
      return NextResponse.json({ category: cat });
    }
    if (action === "move") {
      const parentId =
        typeof body?.parentId === "string" && body.parentId
          ? body.parentId
          : null;
      await moveCategory(id, parentId);
      return NextResponse.json({ ok: true });
    }
    if (action === "reorder") {
      const dir = body?.direction === "up" ? "up" : "down";
      await reorderCategory(id, dir);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "error";
    const client = ["EMPTY_NAME", "NOT_FOUND", "PARENT_NOT_FOUND", "CYCLE"];
    return NextResponse.json(
      { error: msg },
      { status: client.includes(msg) ? 400 : 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { id } = await params;
  await deleteCategory(id);
  return NextResponse.json({ ok: true });
}
