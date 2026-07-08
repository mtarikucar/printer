import { NextRequest, NextResponse } from "next/server";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { painters } from "@/lib/db/schema";
import { publishRealtime } from "@/lib/realtime/bus";
import { topics } from "@/lib/realtime/events";
import { notifyPainter } from "@/lib/services/painter-notifications";

const bodySchema = z.object({ reason: z.string().max(1000).optional() });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { id } = await params;

  let reason: string | undefined;
  try {
    reason = bodySchema.parse(await request.json().catch(() => ({}))).reason;
  } catch {
    return NextResponse.json({ error: "Geçersiz istek" }, { status: 400 });
  }

  const [p] = await db
    .update(painters)
    .set({ status: "rejected", rejectionReason: reason ?? null, updatedAt: new Date() })
    .where(
      and(
        eq(painters.id, id),
        inArray(painters.status, ["pending_approval", "conditionally_approved"])
      )
    )
    .returning();

  if (!p) {
    return NextResponse.json(
      { error: "Boyacı bulunamadı veya reddedilebilir durumda değil" },
      { status: 400 }
    );
  }

  await publishRealtime([topics.admin()], { kind: "badge" });

  await notifyPainter({
    painterId: id,
    type: "system_announcement",
    subject: "Başvurunuz reddedildi",
    body: reason
      ? `Boyacı başvurunuz reddedildi. Sebep: ${reason}`
      : "Boyacı başvurunuz reddedildi.",
  }).catch((e) => console.error("notifyPainter (reject) failed", e));

  return NextResponse.json({ success: true });
}
