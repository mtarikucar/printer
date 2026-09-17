import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";
import { adjustmentCreateSchema, createPartnerAdjustment, loadOrderAdjustments, PartnerAdjustmentError } from "@/lib/services/partner-adjustments";

type Context = { params: Promise<{ id: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Sipariş bulunamadı." }, { status: 404 });
    return NextResponse.json(await loadOrderAdjustments(id));
  } catch (error) {
    if (error instanceof PartnerAdjustmentError) return NextResponse.json({ error: `Hak ediş düzeltmesi yapılamadı: ${error.message}`, code: error.code }, { status: error.status });
    return handleRouteFailure(error, "admin order adjustments GET", "Hak ediş düzeltmeleri okunamadı. Lütfen tekrar deneyin.");
  }
}
export async function POST(request: NextRequest, { params }: Context) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Sipariş bulunamadı." }, { status: 404 });
    const parsed = adjustmentCreateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Geçerli net tutarı, kaynağı ve en az 10 karakterlik gerekçeyi girin." }, { status: 400 });
    return NextResponse.json(await createPartnerAdjustment({ orderId: id, input: parsed.data, adminEmail: a.session.user.email }));
  } catch (error) {
    if (error instanceof PartnerAdjustmentError) return NextResponse.json({ error: `Hak ediş düzeltmesi yapılamadı: ${error.message}`, code: error.code }, { status: error.status });
    return handleRouteFailure(error, "admin order adjustments POST", ADMIN_ACTION_FAILED_ERROR);
  }
}
