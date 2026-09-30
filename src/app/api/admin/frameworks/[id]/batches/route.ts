/**
 * `POST /api/admin/frameworks/[id]/batches` — parti planlar.
 *
 * `dryRun: true` HİÇBİR SATIR YAZMAZ ve tutarları geri döner: parti
 * planlayıcısının TUTAR ÖNİZLEMESİ buradan gelir. Program değişmezi gereği
 * ekran kendi para aritmetiğini kurmaz — `client.tsx` dosyalarında çarpma,
 * bölme ve oran YOKTUR — yani önizlemeyi sunucunun vermesi bir kolaylık değil,
 * kuralın uygulanma biçimidir.
 *
 * Gövde adet ve tarih taşır, TUTAR TAŞIMAZ: kilitli birim fiyat anlaşmanın
 * donmuş anlık görüntüsünden okunur ve brütü `computeQuote` hesaplar.
 */
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_ACTION_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { planBatches } from "@/lib/services/quote-framework";
import { frameworkPlanSchema } from "@/lib/validators/quote-framework";
import {
  frameworkBody,
  frameworkContext,
  refusalResponse,
  runFrameworkService,
} from "../../_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    const a = await frameworkContext(ctx);
    if ("response" in a) return a.response;

    const parsed = await frameworkBody(request, frameworkPlanSchema);
    if ("response" in parsed) return parsed.response;
    const body = parsed.body;

    const call = await runFrameworkService(() =>
      planBatches({
        frameworkId: a.frameworkId,
        adminEmail: a.session.user.email,
        reason: body.reason,
        batches: body.batches.map((b) => ({
          plannedShipDate: b.plannedShipDate,
          lines: b.lines,
          note: b.note ?? null,
        })),
        dryRun: body.dryRun === true,
      })
    );
    if ("response" in call) return call.response;
    if (!call.value.ok) return refusalResponse(call.value.refusals);
    return NextResponse.json({
      success: true,
      dryRun: body.dryRun === true,
      batches: call.value.batches,
    });
  } catch (e) {
    return handleRouteFailure(
      e,
      "POST /api/admin/frameworks/[id]/batches",
      ADMIN_ACTION_FAILED_ERROR
    );
  }
}
