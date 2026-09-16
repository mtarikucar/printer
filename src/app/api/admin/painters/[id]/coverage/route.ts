import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { painters } from "@/lib/db/schema";
import { painterMapBodySchema } from "@/lib/validators/network-map";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

/**
 * Boyacının harita görünürlüğü. Kapsama YOK: boyacıyı üretici elle seçiyor,
 * mesafeye göre sıralayan bir ranker bulunmadığından etki alanı verisinin
 * tüketicisi olmazdı.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const { id } = await params;
    const parsed = painterMapBodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Geçersiz istek" },
        { status: 400 }
      );
    }

    const existing = await db.query.painters.findFirst({
      where: eq(painters.id, id),
      columns: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Boyacı bulunamadı" }, { status: 404 });
    }

    await db
      .update(painters)
      .set({ mapVisible: parsed.data.mapVisible, updatedAt: new Date() })
      .where(eq(painters.id, id));

    revalidatePath("/");

    return NextResponse.json({ success: true });
  } catch (e) {
    return handleRouteFailure(e, "PATCH /api/admin/painters/[id]/coverage", ADMIN_ACTION_FAILED_ERROR);
  }
}
