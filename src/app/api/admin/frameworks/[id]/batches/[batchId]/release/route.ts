/**
 * `POST /api/admin/frameworks/[id]/batches/[batchId]/release` — partiyi serbest
 * bırakır: klon teklifi açar ve partiyi ona bağlar.
 *
 * Bu ucun ardından müşterinin ÖDENEBİLİR bir teklifi doğar, o yüzden iki şey
 * servisin içinde durur ve bu rota onları KOPYALAMAZ: korumalı UPDATE (iki
 * admin aynı partiyi bırakırsa yalnız biri kazanır) ve EŞİTLİK KAPISI (klonun
 * bugün hesaplanan brütü partinin kilitli tutarına eşit değilse işlem geri
 * alınır, 409 `framework_price_drift`).
 *
 * `expectedAmountKurus` bir BEYANDIR, girdi değil: ekranın gördüğü tutar
 * partinin tutarından farklıysa istek 409 döner. Tahsil edilecek tutar hiçbir
 * hâlde gövdeden gelmez.
 */
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_ACTION_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { releaseBatch } from "@/lib/services/quote-framework";
import { frameworkReleaseSchema } from "@/lib/validators/quote-framework";
import {
  batchIdOf,
  frameworkBody,
  frameworkContext,
  frameworkNotFound,
  runFrameworkService,
} from "../../../../_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; batchId: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    const a = await frameworkContext(ctx);
    if ("response" in a) return a.response;
    const { batchId: rawBatchId } = await ctx.params;
    const batchId = batchIdOf(rawBatchId);
    if (batchId === null) return frameworkNotFound();

    const parsed = await frameworkBody(request, frameworkReleaseSchema);
    if ("response" in parsed) return parsed.response;
    const body = parsed.body;

    const call = await runFrameworkService(() =>
      releaseBatch({
        frameworkId: a.frameworkId,
        batchId,
        adminEmail: a.session.user.email,
        reason: body.reason,
        ...(body.expectedAmountKurus === undefined
          ? {}
          : { expectedAmountKurus: body.expectedAmountKurus }),
      })
    );
    if ("response" in call) return call.response;
    return NextResponse.json({ success: true, ...call.value });
  } catch (e) {
    return handleRouteFailure(
      e,
      "POST /api/admin/frameworks/[id]/batches/[batchId]/release",
      ADMIN_ACTION_FAILED_ERROR
    );
  }
}
