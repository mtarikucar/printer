import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { requireActiveSeller } from "@/lib/services/manufacturer-guard";

/**
 * Restore an archived product: archived -> draft. The seller then re-submits
 * through the normal moderation flow (draft -> pending_review -> active), so
 * the admin gate is preserved.
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

  const [updated] = await db
    .update(products)
    .set({ status: "draft", updatedAt: new Date() })
    .where(
      and(
        eq(products.id, id),
        eq(products.manufacturerId, guard.manufacturerId),
        eq(products.status, "archived")
      )
    )
    .returning();

  if (!updated) {
    return NextResponse.json(
      { error: "Product is not archived" },
      { status: 400 }
    );
  }
  return NextResponse.json({ product: updated });
}
