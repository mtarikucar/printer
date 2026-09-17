import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";
import { editOrderMoneySplit, loadMoneySplitEdit } from "@/lib/services/order-money-edit";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { emitOrderChanged } from "@/lib/realtime/emit";

const bodySchema = z.object({
  productionKurus: z.number().int().positive().max(2147483647),
  paintingKurus: z.number().int().nonnegative().max(2147483647),
  expectedProductionKurus: z.number().int().nonnegative(),
  expectedPaintingKurus: z.number().int().nonnegative(),
  reason: z.string().trim().min(10, "Değişiklik gerekçesi en az 10 karakter olmalıdır.").max(1000),
});
const idSchema = z.string().uuid();
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Context) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const { id } = await params;
    if (!idSchema.safeParse(id).success) return NextResponse.json({ error: "Sipariş bulunamadı." }, { status: 404 });
    const view = await loadMoneySplitEdit(id);
    return view ? NextResponse.json(view) : NextResponse.json({ error: "Sipariş bulunamadı." }, { status: 404 });
  } catch (error) {
    return handleRouteFailure(error, "admin money-split read", "Kalem bilgileri okunamadı. Lütfen tekrar deneyin.");
  }
}

export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const { id } = await params;
    if (!idSchema.safeParse(id).success) return NextResponse.json({ error: "Sipariş bulunamadı." }, { status: 404 });
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Geçerli tutarları ve en az 10 karakterlik gerekçeyi girin." }, { status: 400 });
    const result = await editOrderMoneySplit({ ...parsed.data, orderId: id, adminEmail: a.session.user.email });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    let warning: string | undefined;
    if (result.changed && result.order.manufacturerId) {
      await notifyManufacturer({
        manufacturerId: result.order.manufacturerId, orderId: id, type: "system_announcement",
        subject: `${result.order.orderNumber}: kalem bölüşümü güncellendi`,
        body: `Siparişin üretim tabanı ${(parsed.data.productionKurus / 100).toFixed(2)} TL, boyama tabanı ${(parsed.data.paintingKurus / 100).toFixed(2)} TL olarak güncellendi. Bunlar komisyon öncesi tutarlardır. Boyamayı kendi atölyenizde yaparsanız boyama tabanı da size aittir; ayrı boyacıya devrederseniz boyacıya aittir. Gerekçe: ${parsed.data.reason}`,
      }).catch((error) => {
        console.error("money-split partner notice", error);
        warning = "Kalemler kaydedildi; üretici bildirimi oluşturulamadı. Üreticiye sipariş mesajlarından bilgi verin.";
      });
    }
    await emitOrderChanged({ orderId: id, orderNumber: result.order.orderNumber, manufacturerId: result.order.manufacturerId, userId: result.order.userId }).catch((error) => console.error("money-split emit", error));
    return NextResponse.json({ ok: true, changed: result.changed, warning });
  } catch (error) {
    return handleRouteFailure(error, "admin money-split write", ADMIN_ACTION_FAILED_ERROR);
  }
}
