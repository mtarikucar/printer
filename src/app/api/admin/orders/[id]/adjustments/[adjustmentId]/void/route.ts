import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";
import { adjustmentCancelSchema, voidPartnerAdjustment, PartnerAdjustmentError } from "@/lib/services/partner-adjustments";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; adjustmentId: string }> }) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const { id, adjustmentId } = await params;
    if (![id, adjustmentId].every(value => z.string().uuid().safeParse(value).success)) return NextResponse.json({ error: "Düzeltme kaydı bulunamadı." }, { status: 404 });
    const parsed = adjustmentCancelSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "İptal için güncel kayıt bilgisi ve en az 10 karakterlik gerekçe gereklidir." }, { status: 400 });
    return NextResponse.json(await voidPartnerAdjustment({ orderId: id, adjustmentId, input: parsed.data, adminEmail: a.session.user.email }));
  } catch (error) {
    if (error instanceof PartnerAdjustmentError) return NextResponse.json({ error: `Hak ediş düzeltmesi yapılamadı: ${error.message}`, code: error.code }, { status: error.status });
    return handleRouteFailure(error, "admin order adjustment void", ADMIN_ACTION_FAILED_ERROR);
  }
}
