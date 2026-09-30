/**
 * `GET /api/admin/frameworks` — anlaşma listesi (`?status=`, `?page=`).
 * `POST /api/admin/frameworks` — fiyatlanmış bir teklifi anlaşmaya dönüştürür.
 *
 * POST gövdesi TUTAR TAŞIMAZ (`_shared.ts`): taahhüt ve kilitli birim fiyatlar
 * kaynak teklifin DONMUŞ anlık görüntüsünden kopyalanır. Gövdeden gelen bir
 * tutar sessizce yok sayılmaz, 400 ile REDDEDİLİR.
 */
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_ACTION_FAILED_ERROR, ADMIN_READ_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { FRAMEWORK_STATUSES, type FrameworkStatus } from "@/lib/config/quote-framework";
import {
  createFrameworkFromQuote,
  listAdminFrameworks,
} from "@/lib/services/quote-framework";
import { frameworkCreateSchema } from "@/lib/validators/quote-framework";
import {
  frameworkBody,
  frameworkListContext,
  refusalResponse,
  runFrameworkService,
} from "./_shared";

export const dynamic = "force-dynamic";

/** Bilinmeyen bir durum süzgeci boş listeye değil, SEBEBİNİ yazan 400'e çıkar. */
function parseStatus(raw: string | null): FrameworkStatus | null | "invalid" {
  if (raw === null || raw === "") return null;
  return (FRAMEWORK_STATUSES as readonly string[]).includes(raw)
    ? (raw as FrameworkStatus)
    : "invalid";
}

export async function GET(request: NextRequest) {
  try {
    const a = await frameworkListContext();
    if ("response" in a) return a.response;

    const status = parseStatus(request.nextUrl.searchParams.get("status"));
    if (status === "invalid") {
      return NextResponse.json(
        { error: "Geçersiz durum süzgeci.", code: "invalid_status" },
        { status: 400 }
      );
    }
    const rawPage = request.nextUrl.searchParams.get("page") ?? "1";
    if (!/^[1-9]\d{0,5}$/.test(rawPage)) {
      return NextResponse.json(
        { error: "Geçersiz sayfa numarası.", code: "invalid_page" },
        { status: 400 }
      );
    }

    const result = await listAdminFrameworks({
      ...(status ? { status } : {}),
      page: Number(rawPage),
    });
    return NextResponse.json(result);
  } catch (e) {
    return handleRouteFailure(e, "GET /api/admin/frameworks", ADMIN_READ_FAILED_ERROR);
  }
}

export async function POST(request: NextRequest) {
  try {
    const a = await frameworkListContext();
    if ("response" in a) return a.response;

    const parsed = await frameworkBody(request, frameworkCreateSchema);
    if ("response" in parsed) return parsed.response;
    const body = parsed.body;

    const call = await runFrameworkService(() =>
      createFrameworkFromQuote({
        quoteId: body.quoteId,
        adminEmail: a.session.user.email,
        reason: body.reason,
        priceLockedUntil: body.priceLockedUntil,
        shippingAddress: body.shippingAddress,
        title: body.title ?? null,
        preferredManufacturerId: body.preferredManufacturerId ?? null,
        customerNote: body.customerNote ?? null,
        adminNote: body.adminNote ?? null,
      })
    );
    if ("response" in call) return call.response;
    if (!call.value.ok) return refusalResponse(call.value.refusals);
    return NextResponse.json({
      success: true,
      id: call.value.id,
      number: call.value.number,
    });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/frameworks", ADMIN_ACTION_FAILED_ERROR);
  }
}
