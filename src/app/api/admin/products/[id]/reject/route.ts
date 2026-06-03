import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { publishRealtime } from "@/lib/realtime/bus";
import { topics } from "@/lib/realtime/events";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";

// Reject a pending product: pending_review -> rejected. Requires a reason that
// is surfaced to the seller so they can fix and resubmit.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { id } = await params;

  let reason = "";
  try {
    const body = await request.json();
    reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  } catch {
    reason = "";
  }
  if (!reason) {
    return NextResponse.json(
      { error: "Rejection reason is required", code: "reason_required" },
      { status: 400 }
    );
  }

  const [updated] = await db
    .update(products)
    .set({
      status: "rejected",
      rejectionReason: reason,
      reviewedByEmail: a.session.user.email,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(products.id, id), eq(products.status, "pending_review")))
    .returning();

  if (!updated) {
    return NextResponse.json(
      { error: "Product is not pending review" },
      { status: 400 }
    );
  }

  await publishRealtime([topics.admin()], { kind: "badge" }).catch(() => {});

  if (updated.manufacturerId) {
    try {
      await notifyManufacturer({
        manufacturerId: updated.manufacturerId,
        type: "system_announcement",
        subject: `Ürününüz reddedildi: ${updated.title}`,
        body: `"${updated.title}" adlı ürününüz reddedildi.\n\nNeden: ${reason}\n\nGerekli düzeltmeleri yapıp tekrar gönderebilirsiniz.`,
      });
    } catch (err) {
      console.error("product reject notify failed:", err);
    }
  }

  return NextResponse.json({ product: updated });
}
