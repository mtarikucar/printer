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

  const [p] = await db
    .update(painters)
    .set({ status: "conditionally_approved", updatedAt: new Date() })
    .where(and(eq(painters.id, id), eq(painters.status, "pending_approval")))
    .returning();

  if (!p) {
    return NextResponse.json(
      { error: "Boyacı bulunamadı veya onay bekleyen durumda değil" },
      { status: 400 }
    );
  }

  await publishRealtime([topics.admin()], { kind: "badge" });

  await notifyPainter({
    painterId: id,
    type: "system_announcement",
    subject: "Başvurunuz koşullu onaylandı",
    body: "Başvurunuz koşullu olarak onaylandı. Tam onay için lütfen daha önce yaptığınız boyama çalışmalarınızdan bir örnek fotoğraf yükleyin.",
  }).catch((e) => console.error("notifyPainter (conditionally-approve) failed", e));

  return NextResponse.json({ success: true });
}
