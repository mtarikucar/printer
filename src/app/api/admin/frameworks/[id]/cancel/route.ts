/**
 * `POST /api/admin/frameworks/[id]/cancel` — anlaşmayı iptal eder. GEREKÇE
 * ZORUNLUDUR.
 *
 * ÖDENMİŞ PARTİLERE DOKUNMAZ (clawback YOK): onlar kendi yaşam döngüsünü
 * sürdürür ve iadeleri bugünkü iade akışının işidir. İptal edilen şey
 * ANLAŞMADIR — durum `cancelled`, PLANLI partiler iptal, fiyat kilidi düşer.
 */
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_ACTION_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { cancelFramework } from "@/lib/services/quote-framework";
import { frameworkCancelSchema } from "@/lib/validators/quote-framework";
import { frameworkBody, frameworkContext, runFrameworkService } from "../../_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    const a = await frameworkContext(ctx);
    if ("response" in a) return a.response;

    const parsed = await frameworkBody(request, frameworkCancelSchema);
    if ("response" in parsed) return parsed.response;

    const call = await runFrameworkService(() =>
      cancelFramework({
        frameworkId: a.frameworkId,
        adminEmail: a.session.user.email,
        reason: parsed.body.reason,
      })
    );
    if ("response" in call) return call.response;
    return NextResponse.json({
      success: true,
      cancelledBatchCount: call.value.cancelledBatchCount,
    });
  } catch (e) {
    return handleRouteFailure(
      e,
      "POST /api/admin/frameworks/[id]/cancel",
      ADMIN_ACTION_FAILED_ERROR
    );
  }
}
