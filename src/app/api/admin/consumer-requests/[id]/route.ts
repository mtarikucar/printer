import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { consumerRequests } from "@/lib/db/schema";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

const ALLOWED = ["in_progress", "resolved", "rejected"] as const;

/** Tüketici talebinin durumunu güncelle (admin). */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const status = body?.status;
    if (!ALLOWED.includes(status)) {
      return NextResponse.json({ error: "Geçersiz durum." }, { status: 400 });
    }

    const note =
      typeof body?.resolutionNote === "string" && body.resolutionNote.trim()
        ? body.resolutionNote.trim().slice(0, 4000)
        : undefined;

    await db
      .update(consumerRequests)
      .set({
        status,
        ...(note ? { resolutionNote: note } : {}),
        // Kapanış anı denetim izidir; yeniden açılırsa temizlenir.
        resolvedAt:
          status === "resolved" || status === "rejected" ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(consumerRequests.id, id));

    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleRouteFailure(e, "PATCH /api/admin/consumer-requests/[id]", ADMIN_ACTION_FAILED_ERROR);
  }
}
