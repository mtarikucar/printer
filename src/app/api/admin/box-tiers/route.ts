import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { priceTierSchema } from "@/lib/validators/product";
import { MAX_TIERS_PER_PRODUCT } from "@/lib/config/bulk";
import {
  boxTierErrorMessage,
  cheapestBoxEligible,
  listBoxTiers,
  replaceBoxTiers,
  validateBoxTiers,
} from "@/lib/services/box-tiers";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR, ADMIN_READ_FAILED_ERROR } from "@/lib/api/route-error";

// The anahtarlık kutusu price ladder. One global ladder, so this route has no
// id segment — the box is a format, not a SKU.

const schema = z.object({
  tiers: z.array(priceTierSchema).max(MAX_TIERS_PER_PRODUCT).default([]),
});

export async function GET() {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const cheapest = await cheapestBoxEligible();
    return NextResponse.json({
      tiers: await listBoxTiers(),
      // Surfaced so the editor can show the ceiling the ladder has to beat.
      cheapestEligible: cheapest,
    });
  } catch (e) {
    return handleRouteFailure(e, "GET /api/admin/box-tiers", ADMIN_READ_FAILED_ERROR);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Geçersiz veri" },
        { status: 400 }
      );
    }

    const cheapest = await cheapestBoxEligible();
    const validation = validateBoxTiers({
      tiers: parsed.data.tiers,
      cheapestEligiblePriceKurus: cheapest?.priceKurus ?? null,
    });
    if (!validation.ok) {
      return NextResponse.json(
        {
          error: boxTierErrorMessage(validation.error, {
            cheapestProductTitle: cheapest?.title,
            cheapestPriceKurus: cheapest?.priceKurus,
          }),
        },
        { status: 400 }
      );
    }

    await replaceBoxTiers(validation.tiers);
    return NextResponse.json({ success: true, tiers: validation.tiers });
  } catch (e) {
    return handleRouteFailure(e, "PUT /api/admin/box-tiers", ADMIN_ACTION_FAILED_ERROR);
  }
}
