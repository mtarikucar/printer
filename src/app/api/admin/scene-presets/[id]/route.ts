import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { scenePresets } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// Update / delete a single scene preset. `slug` is immutable (it's persisted on
// previews.scene), so only the editable fields are accepted here.
const updateSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(300).optional(),
  promptFragment: z.string().trim().max(2000).optional(),
  peopleHint: z.enum(["single", "multiple", "any"]).optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;

  const { id } = await params;
  try {
    const body = updateSchema.parse(await request.json());
    if (Object.keys(body).length === 0) {
      return NextResponse.json({ error: "Boş güncelleme" }, { status: 400 });
    }

    const [updated] = await db
      .update(scenePresets)
      .set({
        ...body,
        // Normalize empty description to null for a clean column.
        ...(body.description !== undefined
          ? { description: body.description || null }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(scenePresets.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Bulunamadı" }, { status: 404 });
    }
    return NextResponse.json({ scenePreset: updated });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Güncellenemedi" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;

  const { id } = await params;
  const [deleted] = await db
    .delete(scenePresets)
    .where(eq(scenePresets.id, id))
    .returning({ id: scenePresets.id });

  if (!deleted) {
    return NextResponse.json({ error: "Bulunamadı" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
