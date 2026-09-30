/**
 * `POST /api/admin/frameworks/[id]/batches/[batchId]/cancel` — PLANLI bir
 * partiyi iptal eder. GEREKÇE ZORUNLUDUR.
 *
 * Yalnız `planned`: serbest bırakılmış bir partide ortada bir sipariş vardır ve
 * onu kapatmak iade motorunun işidir (`/admin/orders/[id]` iade akışı), bu
 * ucun değil. İptal edilen PLANLI partide para HİÇ HAREKET ETMEMİŞTİR, o yüzden
 * taahhüt de serbest kalır (saf çekirdek: `frameworkLineConsumesCommitment`).
 */
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_ACTION_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { cancelBatch } from "@/lib/services/quote-framework";
import { frameworkCancelSchema } from "@/lib/validators/quote-framework";
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

    const parsed = await frameworkBody(request, frameworkCancelSchema);
    if ("response" in parsed) return parsed.response;

    const call = await runFrameworkService(() =>
      cancelBatch({
        frameworkId: a.frameworkId,
        batchId,
        adminEmail: a.session.user.email,
        reason: parsed.body.reason,
      })
    );
    if ("response" in call) return call.response;
    return NextResponse.json({ success: true, batchId: call.value.batchId });
  } catch (e) {
    return handleRouteFailure(
      e,
      "POST /api/admin/frameworks/[id]/batches/[batchId]/cancel",
      ADMIN_ACTION_FAILED_ERROR
    );
  }
}
