import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { painters } from "@/lib/db/schema";
import { publishRealtime } from "@/lib/realtime/bus";
import { topics } from "@/lib/realtime/events";
import { notifyPainter } from "@/lib/services/painter-notifications";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const { id } = await params;

    const [painter] = await db
      .update(painters)
      .set({ status: "active", updatedAt: new Date() })
      .where(and(eq(painters.id, id), eq(painters.status, "suspended")))
      .returning();

    if (!painter) {
      return NextResponse.json(
        { error: "Boyacı bulunamadı veya askıda değil" },
        { status: 400 }
      );
    }

    await publishRealtime([topics.admin()], { kind: "badge" });

    await notifyPainter({
      painterId: id,
      type: "system_announcement",
      subject: "Hesabınız yeniden aktif edildi",
      body: "Boyacı hesabınızdaki askı kaldırıldı. Yeniden boyama işi alabilirsiniz. Tekrar aramızda olmanıza sevindik!",
    }).catch((e) => console.error("notifyPainter (reactivate) failed", e));

    return NextResponse.json({ success: true });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/painters/[id]/activate", ADMIN_ACTION_FAILED_ERROR);
  }
}
