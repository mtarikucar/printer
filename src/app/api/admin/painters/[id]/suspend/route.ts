import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { painters } from "@/lib/db/schema";
import { publishRealtime } from "@/lib/realtime/bus";
import { topics } from "@/lib/realtime/events";
import { notifyPainter } from "@/lib/services/painter-notifications";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;

  const { id } = await params;

  const [painter] = await db
    .update(painters)
    .set({ status: "suspended", updatedAt: new Date() })
    .where(and(eq(painters.id, id), eq(painters.status, "active")))
    .returning();

  if (!painter) {
    return NextResponse.json(
      { error: "Boyacı bulunamadı veya aktif değil" },
      { status: 400 }
    );
  }

  await publishRealtime([topics.admin()], { kind: "badge" });

  await notifyPainter({
    painterId: id,
    type: "system_announcement",
    subject: "Hesabınız askıya alındı",
    body: "Boyacı hesabınız geçici olarak askıya alındı. Yeni boyama işi alamazsınız. Ayrıntılar için lütfen bizimle iletişime geçin.",
  }).catch((e) => console.error("notifyPainter (suspend) failed", e));

  return NextResponse.json({ success: true });
}
