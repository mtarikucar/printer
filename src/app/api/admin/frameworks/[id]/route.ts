/**
 * `GET  /api/admin/frameworks/[id]` — anlaşmanın tam hâli (taahhüt, partiler,
 *        siparişleri, kova kırılımı, İKİ AYRI toplam).
 * `PATCH /api/admin/frameworks/[id]` — admin notu ve ÇAPALI ATÖLYE.
 *
 * PATCH parayı DEĞİŞTİRMEZ: ne taahhüt, ne kilitli fiyat, ne parti tutarı.
 * Gövdede tutar alanı gelirse istek 400 ile reddedilir (`_shared.ts`).
 *
 * PATCH bir YAZMA ucudur ve kendi denetim satırını düşürür
 * (`framework_update`, gerekçe ≥10 karakter) — satırı yazan rota değil,
 * servisin kendi işlemidir (`setFrameworkPreferences`).
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  ADMIN_ACTION_FAILED_ERROR,
  ADMIN_READ_FAILED_ERROR,
  handleRouteFailure,
} from "@/lib/api/route-error";
import {
  loadFrameworkDetail,
  setFrameworkPreferences,
} from "@/lib/services/quote-framework";
import { frameworkPatchSchema } from "@/lib/validators/quote-framework";
import {
  frameworkBody,
  frameworkContext,
  frameworkNotFound,
  runFrameworkService,
} from "../_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, ctx: Ctx) {
  try {
    const a = await frameworkContext(ctx);
    if ("response" in a) return a.response;

    const detail = await loadFrameworkDetail(a.frameworkId);
    if (!detail) return frameworkNotFound();
    return NextResponse.json(detail);
  } catch (e) {
    return handleRouteFailure(e, "GET /api/admin/frameworks/[id]", ADMIN_READ_FAILED_ERROR);
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  try {
    const a = await frameworkContext(ctx);
    if ("response" in a) return a.response;

    const parsed = await frameworkBody(request, frameworkPatchSchema);
    if ("response" in parsed) return parsed.response;
    const body = parsed.body;

    const call = await runFrameworkService(() =>
      setFrameworkPreferences({
        frameworkId: a.frameworkId,
        adminEmail: a.session.user.email,
        reason: body.reason,
        // `undefined` = DOKUNMA, `null` = KALDIR. İkisini tek değere
        // indirgemek, notu silmek isteyen bir isteği sessizce yok sayardı.
        ...(body.adminNote === undefined ? {} : { adminNote: body.adminNote }),
        ...(body.preferredManufacturerId === undefined
          ? {}
          : { preferredManufacturerId: body.preferredManufacturerId }),
      })
    );
    if ("response" in call) return call.response;
    return NextResponse.json({
      success: true,
      preferredManufacturerId: call.value.preferredManufacturerId,
    });
  } catch (e) {
    return handleRouteFailure(e, "PATCH /api/admin/frameworks/[id]", ADMIN_ACTION_FAILED_ERROR);
  }
}
