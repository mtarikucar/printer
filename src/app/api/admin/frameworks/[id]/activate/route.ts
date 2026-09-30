/**
 * `POST /api/admin/frameworks/[id]/activate` — taslak anlaşmayı AKTİF eder.
 *
 * Aktifleşen şey FİYAT KİLİDİDİR: bundan sonra parti serbest bırakılabilir ve
 * her parti anlaşmanın DONMUŞ anlık görüntüsünden fiyatlanır. Para bu uçta
 * değişmez; gövde de tutar taşımaz (`_shared.ts`).
 */
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_ACTION_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { activateFramework } from "@/lib/services/quote-framework";
import { frameworkActivateSchema } from "@/lib/validators/quote-framework";
import { frameworkBody, frameworkContext, runFrameworkService } from "../../_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    const a = await frameworkContext(ctx);
    if ("response" in a) return a.response;

    const parsed = await frameworkBody(request, frameworkActivateSchema);
    if ("response" in parsed) return parsed.response;

    const call = await runFrameworkService(() =>
      activateFramework({
        frameworkId: a.frameworkId,
        adminEmail: a.session.user.email,
        reason: parsed.body.reason,
      })
    );
    if ("response" in call) return call.response;
    return NextResponse.json({ success: true, number: call.value.number });
  } catch (e) {
    return handleRouteFailure(
      e,
      "POST /api/admin/frameworks/[id]/activate",
      ADMIN_ACTION_FAILED_ERROR
    );
  }
}
