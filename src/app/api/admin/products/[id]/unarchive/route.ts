import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";

/**
 * Admin restore of an archived product. A product that has a slug was live at
 * some point and archiving blocks edits, so its content is unchanged — the
 * admin clicking restore IS the moderation decision: it goes straight back to
 * `active`. A product that never got a slug was never published; it returns
 * to `draft` so it flows through the normal submit -> approve pipeline.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { id } = await params;

  const existing = await db.query.products.findFirst({
    where: eq(products.id, id),
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (existing.status !== "archived") {
    return NextResponse.json(
      { error: "Product is not archived" },
      { status: 400 }
    );
  }

  const nextStatus = existing.slug ? ("active" as const) : ("draft" as const);
  const [updated] = await db
    .update(products)
    .set({
      status: nextStatus,
      reviewedByEmail:
        nextStatus === "active" ? a.session.user.email : existing.reviewedByEmail,
      reviewedAt: nextStatus === "active" ? new Date() : existing.reviewedAt,
      updatedAt: new Date(),
    })
    .where(and(eq(products.id, id), eq(products.status, "archived")))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Restore failed" }, { status: 409 });
  }
  return NextResponse.json({ product: updated });
}
