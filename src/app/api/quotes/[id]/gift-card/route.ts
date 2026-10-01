/**
 * `POST /api/quotes/[id]/gift-card` — ödeme ÖNCESİ hediye kartı ön izlemesi.
 *
 * SALT OKUNUR: kart doğrulanır ve teklifin kendi snapshot'ından ödenecek tutar
 * hesaplanır; rezervasyon ödeme anında yapılır (`POST …/checkout`). Müşterinin
 * kodu girmesi bir ödeme yükümlülüğü doğurmaz, bu yüzden bakiyesine de
 * dokunulmaz.
 *
 * Kapılar `checkout` ucunun AYNISI (oturum → ÖDEME YETKİSİ → gövde) ve para
 * hesabının tamamı `quote-checkout.ts`tedir: ekranın gördüğü rakam ile tahsil
 * edilen rakamın aynı zincirden çıkması bu özelliğin tek gerçek şartı, ve iki
 * ayrı hesap kopyası onu bir gün bozardı.
 *
 * YETKİ ÖLÇÜSÜ "ÖDEYEBİLEN"DİR, "GÖREBİLEN" DEĞİL (0072): bu uç `computeQuote`
 * sonucunu döndürüyor (bakiye, karşılanan tutar, havale indirimi), yani bir
 * FİYAT yüzeyidir. Takımda ödeme yetkisi olmayan bir üyeye kart ön izlemesi
 * göstermenin işlevi yok — göstereceği tek şey, basamayacağı düğmenin
 * arkasındaki rakamlar olurdu.
 *
 * ÖZELLİK BAYRAĞI (`quote_gift_card_enabled`) kapalıyken uç YOKTUR (404):
 * kapalı bir satış yüzeyinin varlığını duyurmanın anlamı yok. Bayrak kapısı
 * oturumdan ÖNCE durur, yani kapalı özellik oturumsuz bir yoklamaya da 404 der.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  CUSTOMER_PAYMENT_FAILED_ERROR,
  handleRouteFailure,
} from "@/lib/api/route-error";
import { canCheckoutQuote } from "@/lib/config/quote-team";
import { getSessionUser } from "@/lib/services/customer-auth";
import { isFlagEnabled } from "@/lib/services/flags";
import { previewQuoteGiftCard } from "@/lib/services/quote-checkout";
import { quoteGiftCardPreviewSchema } from "@/lib/validators/quote-checkout";
import { accessOr404, jsonBody, quoteNotFound, quoteRouteBody } from "../../_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function handlePOST(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  if (!(await isFlagEnabled("quote_gift_card_enabled"))) return quoteNotFound();

  const session = await getSessionUser();
  if (!session) {
    // Cümle `checkout` ucuyla BİREBİR: ön izleme ödemenin bir adımıdır ve
    // müşteri iki yüzeyde iki farklı açıklama görmemeli.
    return NextResponse.json(
      { error: "Ödeme için giriş yapmanız gerekiyor.", code: "auth_required" },
      { status: 401 }
    );
  }

  const found = await accessOr404(request, id, { forEdit: true });
  if ("response" in found) return found.response;
  const { quote, viewer } = found.access;

  // Anonim çerez sahibi de "sahip"tir ama fiyat kapısını geçmemiştir ve ödediği
  // siparişin bağlanacağı bir hesabı yoktur: ön izleme FİYAT döner, yani
  // `checkout` ile AYNI ölçüyü ister (`quote.userId === null` dalı orada 409
  // `quote_unclaimed`; burada ön izlemenin söyleyecek ayrı bir cümlesi yok).
  if (quote.userId === null || !canCheckoutQuote(viewer, found.access.team)) {
    return NextResponse.json(
      { error: "Bu teklifi ödeme yetkiniz yok.", code: "not_owner" },
      { status: 403 }
    );
  }

  const parsed = quoteGiftCardPreviewSchema.safeParse(await jsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Hediye kartı kodunu kontrol edin.", code: "invalid_body" },
      { status: 400 }
    );
  }

  const preview = await previewQuoteGiftCard({
    quoteId: quote.id,
    // Oran limiti ve ödeme yetkisi ÖDEYECEK kişiye bağlıdır (değişmez 3).
    userId: session.userId,
    code: parsed.data.code,
    req: request,
    actor: {
      role: found.access.team?.role ?? null,
      memberCanCheckout: found.access.team?.memberCanCheckout ?? false,
    },
  });
  return NextResponse.json(preview);
}

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    return await quoteRouteBody(() => handlePOST(request, ctx));
  } catch (e) {
    return handleRouteFailure(
      e,
      "POST /api/quotes/[id]/gift-card",
      CUSTOMER_PAYMENT_FAILED_ERROR
    );
  }
}
