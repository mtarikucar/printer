/**
 * `POST /api/admin/frameworks/[id]/extend` — fiyat kilidini İLERİ taşır.
 * GEREKÇE ZORUNLUDUR.
 *
 * TUTARA DOKUNMAZ: kilitli birim fiyatlar ve taahhüt aynı kalır, yalnız
 * geçerlilik günü uzar. Süresi dolmuş bir anlaşma uzatmayla yeniden `active`
 * olur; tarih GERİYE alınamaz (servis kapısı), çünkü geri almak bugün serbest
 * bırakılabilir bir partiyi sessizce reddedilebilir hâle sokmaktı.
 */
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_ACTION_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { extendFrameworkLock } from "@/lib/services/quote-framework";
import { frameworkExtendSchema } from "@/lib/validators/quote-framework";
import { frameworkBody, frameworkContext, runFrameworkService } from "../../_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    const a = await frameworkContext(ctx);
    if ("response" in a) return a.response;

    const parsed = await frameworkBody(request, frameworkExtendSchema);
    if ("response" in parsed) return parsed.response;

    const call = await runFrameworkService(() =>
      extendFrameworkLock({
        frameworkId: a.frameworkId,
        adminEmail: a.session.user.email,
        reason: parsed.body.reason,
        priceLockedUntil: parsed.body.priceLockedUntil,
      })
    );
    if ("response" in call) return call.response;
    return NextResponse.json({
      success: true,
      priceLockedUntil: call.value.priceLockedUntil,
      status: call.value.status,
    });
  } catch (e) {
    return handleRouteFailure(
      e,
      "POST /api/admin/frameworks/[id]/extend",
      ADMIN_ACTION_FAILED_ERROR
    );
  }
}
