import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { disputes } from "@/lib/db/schema";
import { reverseEarning } from "@/lib/services/payouts";
import { applyStrike } from "@/lib/services/strikes";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";

const schema = z.object({
  action: z.enum(["resolve", "reject"]),
  resolution: z.string().trim().max(2000).optional(),
  clawback: z.boolean().optional(),
});

// Admin resolves/rejects a dispute. When resolving with clawback, the
// manufacturer's earning is reversed and a strike applied.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { id } = await params;

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const dispute = await db.query.disputes.findFirst({
    where: eq(disputes.id, id),
    with: { order: { columns: { id: true, manufacturerId: true } } },
  });
  if (!dispute) return NextResponse.json({ error: "Dispute not found" }, { status: 404 });
  if (dispute.status !== "open") {
    return NextResponse.json({ error: "Dispute already closed" }, { status: 400 });
  }

  const [updated] = await db
    .update(disputes)
    .set({
      status: parsed.data.action === "resolve" ? "resolved" : "rejected",
      resolution: parsed.data.resolution ?? null,
      adminEmail: a.session.user.email,
      resolvedAt: new Date(),
    })
    .where(and(eq(disputes.id, id), eq(disputes.status, "open")))
    .returning({ id: disputes.id });
  if (!updated) return NextResponse.json({ error: "Already closed" }, { status: 400 });

  if (parsed.data.action === "resolve" && parsed.data.clawback) {
    await reverseEarning(dispute.order.id);
    if (dispute.order.manufacturerId) {
      await notifyManufacturer({
        manufacturerId: dispute.order.manufacturerId,
        type: "system_announcement",
        subject: "Sipariş anlaşmazlığı sonucu hak ediş iadesi",
        body: "Bir müşteri anlaşmazlığı sizin aleyhinize sonuçlandığı için ilgili siparişin hak edişi geri alındı ve hesabınıza bir ihlal kaydı işlendi. Detaylar için üretici panelinizi inceleyin.",
        orderId: dispute.order.id,
      }).catch((e) => console.error("notifyManufacturer (clawback) failed", e));
      await applyStrike(dispute.order.manufacturerId);
    }
  }

  return NextResponse.json({ success: true });
}
