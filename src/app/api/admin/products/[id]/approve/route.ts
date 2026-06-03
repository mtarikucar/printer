import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { publishRealtime } from "@/lib/realtime/bus";
import { topics } from "@/lib/realtime/events";
import { generateProductSlug } from "@/lib/services/slug";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";

// Approve a pending product: pending_review -> active. Mints the storefront slug
// (preserving an existing one on re-approval) and notifies the seller.
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

  // Slug computed outside the guarded update so the uniqueness check runs
  // against the latest state. Reuse an existing slug if the product was
  // previously published (edit → re-review → re-approve keeps the URL stable).
  const slug = existing.slug ?? (await generateProductSlug(existing.title));

  const [updated] = await db
    .update(products)
    .set({
      status: "active",
      slug,
      rejectionReason: null,
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
        subject: `Ürününüz onaylandı: ${updated.title}`,
        body: `"${updated.title}" adlı ürününüz onaylandı ve mağazada yayında.`,
      });
    } catch (err) {
      console.error("product approve notify failed:", err);
    }
  }

  return NextResponse.json({ product: updated });
}
