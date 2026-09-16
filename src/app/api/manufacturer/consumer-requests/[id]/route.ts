import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { consumerRequests } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { handleRouteFailure, PARTNER_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

const ALLOWED = ["in_progress", "resolved", "rejected"] as const;

/**
 * Tüketici talebinin durumunu güncelle (satıcı).
 *
 * WHERE koşulu talebi satıcının KENDİ siparişleriyle sınırlar: id tahmin
 * edilebilir olmasa da, yetki kontrolünü sorgunun içinde tutmak başka bir
 * satıcının talebine dokunulmasını yapısal olarak engeller.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getManufacturerSession();
    if (!session) {
      return NextResponse.json({ error: "Yetkisiz." }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const status = body?.status;
    if (!ALLOWED.includes(status)) {
      return NextResponse.json({ error: "Geçersiz durum." }, { status: 400 });
    }

    const note =
      typeof body?.resolutionNote === "string" && body.resolutionNote.trim()
        ? body.resolutionNote.trim().slice(0, 4000)
        : undefined;

    const updated = await db
      .update(consumerRequests)
      .set({
        status,
        ...(note ? { resolutionNote: note } : {}),
        resolvedAt:
          status === "resolved" || status === "rejected" ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(consumerRequests.id, id),
          eq(consumerRequests.sellerManufacturerId, session.manufacturerId)
        )
      )
      .returning({ id: consumerRequests.id });

    if (updated.length === 0) {
      return NextResponse.json({ error: "Talep bulunamadı." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleRouteFailure(e, "PATCH /api/manufacturer/consumer-requests/[id]", PARTNER_ACTION_FAILED_ERROR);
  }
}
