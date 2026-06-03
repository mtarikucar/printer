import { NextRequest, NextResponse } from "next/server";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { requireActiveSeller } from "@/lib/services/manufacturer-guard";
import { publishRealtime } from "@/lib/realtime/bus";
import { topics } from "@/lib/realtime/events";

/**
 * Submit a draft/rejected product for admin moderation: -> pending_review.
 * Requires at least one image (a buyable listing must have a photo).
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireActiveSeller();
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const { id } = await params;

  const product = await db.query.products.findFirst({
    where: and(
      eq(products.id, id),
      eq(products.manufacturerId, guard.manufacturerId)
    ),
    with: { images: true },
  });
  if (!product) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (product.images.length === 0) {
    return NextResponse.json(
      { error: "Add at least one image before submitting", code: "no_images" },
      { status: 400 }
    );
  }

  // Atomic transition guarded on the current state so a double-submit is a no-op.
  const [updated] = await db
    .update(products)
    .set({ status: "pending_review", submittedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(products.id, id),
        eq(products.manufacturerId, guard.manufacturerId),
        inArray(products.status, ["draft", "rejected"])
      )
    )
    .returning();

  if (!updated) {
    return NextResponse.json(
      { error: "Product is not in a submittable state" },
      { status: 400 }
    );
  }

  // Nudge the admin moderation badge.
  await publishRealtime([topics.admin()], { kind: "badge" }).catch(() => {});

  return NextResponse.json({ product: updated });
}
