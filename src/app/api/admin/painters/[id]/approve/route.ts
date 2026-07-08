import { NextRequest, NextResponse } from "next/server";
import { eq, and, isNotNull } from "drizzle-orm";
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

  // Full approval requires the conditional-approval gate to be satisfied: the
  // painter must have uploaded a work-sample photo (mirrors the manufacturer
  // printer-photo gate).
  const [p] = await db
    .update(painters)
    .set({ status: "active", updatedAt: new Date() })
    .where(
      and(
        eq(painters.id, id),
        eq(painters.status, "conditionally_approved"),
        isNotNull(painters.workSamplePhotoUploadedAt)
      )
    )
    .returning();

  if (!p) {
    return NextResponse.json(
      {
        error:
          "Boyacı koşullu onaylı olmalı ve örnek çalışma fotoğrafı yüklenmiş olmalı",
      },
      { status: 400 }
    );
  }

  await publishRealtime([topics.admin()], { kind: "badge" });

  await notifyPainter({
    painterId: id,
    type: "system_announcement",
    subject: "Başvurunuz onaylandı",
    body: "Boyacı başvurunuz onaylandı. Artık boyama işleri alabilirsiniz. Aramıza hoş geldiniz!",
  }).catch((e) => console.error("notifyPainter (approve) failed", e));

  return NextResponse.json({ success: true });
}
