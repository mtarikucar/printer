import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { updateProductBulkSchema } from "@/lib/validators/product";
import {
  getProductBulkSettings,
  listTiers,
  replaceTiers,
  tierErrorMessage,
  validateTiers,
} from "@/lib/services/product-tiers";

// Toplu sipariş settings + the volume ladder for one product. Admin-only by
// design: a tier cuts the seller's 65% payout, so in v1 only platform-owned
// (ownerType='admin') products may carry one — enforced in validateTiers, not
// just hidden in the UI.

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { id } = await params;

  const product = await getProductBulkSettings(id);
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    ownerType: product.ownerType,
    priceKurus: product.priceKurus,
    bulkEnabled: product.bulkEnabled,
    bulkMaxQuantity: product.bulkMaxQuantity,
    bulkLeadTimeDays: product.bulkLeadTimeDays,
    tiers: await listTiers(id),
  });
}

// Atomic replace of the whole ladder plus the product's bulk settings. Partial
// updates are not supported: validateTiers proves its invariants across the
// complete set, and a half-applied ladder could violate them.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { id } = await params;

  const product = await getProductBulkSettings(id);
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const parsed = updateProductBulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Geçersiz veri" },
      { status: 400 }
    );
  }
  const input = parsed.data;

  const validation = validateTiers({
    basePriceKurus: product.priceKurus,
    tiers: input.tiers,
    bulkMaxQuantity: input.bulkMaxQuantity,
    bulkEnabled: input.bulkEnabled,
    ownerType: product.ownerType,
  });
  if (!validation.ok) {
    return NextResponse.json(
      { error: tierErrorMessage(validation.error) },
      { status: 400 }
    );
  }

  await replaceTiers(id, validation.tiers);
  await db
    .update(products)
    .set({
      bulkEnabled: input.bulkEnabled,
      bulkMaxQuantity: input.bulkMaxQuantity,
      bulkLeadTimeDays: input.bulkLeadTimeDays,
      updatedAt: new Date(),
    })
    .where(eq(products.id, id));

  return NextResponse.json({
    success: true,
    bulkEnabled: input.bulkEnabled,
    bulkMaxQuantity: input.bulkMaxQuantity,
    bulkLeadTimeDays: input.bulkLeadTimeDays,
    tiers: validation.tiers,
  });
}
