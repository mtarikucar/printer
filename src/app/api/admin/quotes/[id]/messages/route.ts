/**
 * `GET|POST /api/admin/quotes/[id]/messages` — teklif sohbetinin ADMIN tarafı.
 *
 * Müşteri ucunun (`/api/quotes/[id]/messages`) ikizi: aynı servis, aynı cevap
 * şekli, farklı rol. Gönderenin rolü SUNUCUDA sabittir ("admin"); gövdeden rol
 * okunmaz. `<OrderChat basePath>` bileşeni bu iki ucu ayırt etmez, bu yüzden
 * cevap şeklinin aynı kalması ZORUNLUDUR.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  ADMIN_ACTION_FAILED_ERROR,
  ADMIN_READ_FAILED_ERROR,
  handleRouteFailure,
} from "@/lib/api/route-error";
import { createQuoteMessage, listQuoteMessages } from "@/lib/services/quote-chat";
import { adminQuoteExists } from "@/lib/services/quote-admin";
import { QuoteServiceError } from "@/lib/services/quote-service";
import { adminQuoteContext, adminQuoteNotFound } from "../../_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Servisin bilinen retleri (boş mesaj, büyük ek, tablo yok) → kendi cümlesi. */
function serviceRefusal(e: unknown): NextResponse | null {
  if (!(e instanceof QuoteServiceError)) return null;
  return NextResponse.json(
    { error: e.message, ...(e.code ? { code: e.code } : {}) },
    { status: e.status }
  );
}

export async function GET(_request: NextRequest, ctx: Ctx) {
  try {
    const a = await adminQuoteContext(ctx);
    if ("response" in a) return a.response;
    if (!(await adminQuoteExists(a.quoteId))) return adminQuoteNotFound();

    return NextResponse.json(await listQuoteMessages(a.quoteId, "admin"));
  } catch (e) {
    return handleRouteFailure(e, "GET /api/admin/quotes/[id]/messages", ADMIN_READ_FAILED_ERROR);
  }
}

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    const a = await adminQuoteContext(ctx);
    if ("response" in a) return a.response;
    if (!(await adminQuoteExists(a.quoteId))) return adminQuoteNotFound();

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json(
        { error: "İstek gövdesi okunamadı.", code: "invalid_body" },
        { status: 400 }
      );
    }
    const file = form.get("file");
    try {
      await createQuoteMessage({
        quoteId: a.quoteId,
        sender: "admin",
        senderEmail: a.session.user.email,
        body: String(form.get("body") ?? ""),
        file: file instanceof File ? file : null,
      });
    } catch (e) {
      const known = serviceRefusal(e);
      if (known) return known;
      throw e;
    }
    return NextResponse.json(await listQuoteMessages(a.quoteId, "admin"));
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/quotes/[id]/messages", ADMIN_ACTION_FAILED_ERROR);
  }
}
