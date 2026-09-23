/**
 * `POST /api/quotes/[id]/checkout` — teklifi ödemeye çevirir.
 *
 * Uç ÜÇ kapıyı tutar ve parayı hiç hesaplamaz: bayrak (`quoteRouteBody`),
 * oturum + sahiplik, gövdenin şekli. Tutarın yeniden hesabı, politika,
 * taslak yazımı ve PayTR/havale işleri `quote-checkout.ts`'tedir — aynı
 * kararların ikinci bir kopyası burada olsaydı, biri bir gün ötekinden
 * kayardı.
 *
 * Sahiplik `viewer.isOwner` ile YETİNMEZ: anonim çerez sahibi de "sahip"tir
 * ama fiyat kapısını geçmemiştir ve ödediği siparişin bağlanacağı bir hesabı
 * yoktur. Admin de ödeyemez — müşterinin adına sözleşme onayı verilemez.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  CUSTOMER_PAYMENT_FAILED_ERROR,
  handleRouteFailure,
} from "@/lib/api/route-error";
import { getSessionUser } from "@/lib/services/customer-auth";
import { createQuoteCheckout } from "@/lib/services/quote-checkout";
import { quoteCheckoutSchema } from "@/lib/validators/quote-checkout";
import { accessOr404, jsonBody, quoteRouteBody } from "../../_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function handlePOST(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json(
      { error: "Ödeme için giriş yapmanız gerekiyor.", code: "auth_required" },
      { status: 401 }
    );
  }

  const found = await accessOr404(request, id, { forEdit: true });
  if ("response" in found) return found.response;
  const { quote, viewer } = found.access;

  if (quote.userId === null) {
    return NextResponse.json(
      {
        error: "Ödemeden önce teklifi hesabınıza bağlayın.",
        code: "quote_unclaimed",
      },
      { status: 409 }
    );
  }
  if (!viewer.isOwner || quote.userId !== session.userId) {
    return NextResponse.json(
      { error: "Bu teklifi yalnız sahibi ödeyebilir.", code: "not_owner" },
      { status: 403 }
    );
  }

  const parsed = quoteCheckoutSchema.safeParse(await jsonBody(request));
  if (!parsed.success) {
    // Zod'un İngilizce ayrıntısı müşteriye gitmez; eksik alanı ekran zaten
    // kendi doğrulamasıyla işaretliyor.
    return NextResponse.json(
      {
        error: "Ödeme bilgilerini kontrol edin: eksik ya da geçersiz alan var.",
        code: "invalid_body",
      },
      { status: 400 }
    );
  }

  const result = await createQuoteCheckout({
    quoteId: quote.id,
    userId: session.userId,
    email: session.email,
    input: parsed.data,
    req: request,
  });
  return NextResponse.json(result);
}

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    return await quoteRouteBody(() => handlePOST(request, ctx));
  } catch (e) {
    return handleRouteFailure(
      e,
      "POST /api/quotes/[id]/checkout",
      CUSTOMER_PAYMENT_FAILED_ERROR
    );
  }
}
