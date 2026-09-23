import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { ADMIN_ACTION_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { catalogOutcome, simulateQuotePrice } from "@/lib/services/quote-catalog-admin";
import { loadActiveSnapshot } from "@/lib/services/quote-catalog";
import { simulateSchema } from "@/lib/validators/print-catalog";
import { catalogRefusal, invalidBody } from "../_shared";

/**
 * Fiyat simülatörü: "şu ölçülerde bir parça bugünkü katalogla kaça çıkar?"
 *
 * Hiçbir şey YAZMAZ, bu yüzden `expectedUpdatedAt` de istemez ve önbellek
 * tazelemez. Kataloğu CANLI okur (`loadActiveSnapshot`): sahibi bir fiyatı
 * değiştirip hemen sonucunu görebilmeli, dondurulmuş bir kopyayı değil.
 *
 * Fiyat `computeQuote`tan gelir — müşteriye gösterilen ve tahsil edilen rakamla
 * AYNI yoldan. İkinci bir hesap yolu, simülatörün "olacak" dediği fiyatla
 * ödeme ekranındaki fiyatın ayrışması demek olurdu.
 */
export async function POST(request: NextRequest) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const parsed = simulateSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return invalidBody(parsed.error);

    const snapshot = await catalogOutcome(() => loadActiveSnapshot());
    if (!snapshot.ok) return catalogRefusal(snapshot);

    const result = simulateQuotePrice(snapshot.value, parsed.data);
    return NextResponse.json({ result, snapshotTakenAt: snapshot.value.takenAt });
  } catch (e) {
    return handleRouteFailure(
      e,
      "POST /api/admin/print-catalog/simulate",
      ADMIN_ACTION_FAILED_ERROR
    );
  }
}
