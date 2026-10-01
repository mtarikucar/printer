/**
 * `POST /api/quotes/[id]/checkout` — teklifi ödemeye çevirir.
 *
 * Uç ÜÇ kapıyı tutar ve parayı hiç hesaplamaz: bayrak (`quoteRouteBody`),
 * oturum + ÖDEME YETKİSİ, gövdenin şekli. Tutarın yeniden hesabı, politika,
 * taslak yazımı ve PayTR/havale işleri `quote-checkout.ts`'tedir — aynı
 * kararların ikinci bir kopyası burada olsaydı, biri bir gün ötekinden
 * kayardı.
 *
 * Yetki `canCheckoutQuote(viewer, team)`dır (0072) ve `viewer.isOwner` ile
 * YETİNMEZ: anonim çerez sahibi de "sahip"tir ama fiyat kapısını geçmemiştir ve
 * ödediği siparişin bağlanacağı bir hesabı yoktur (aşağıdaki `quote_unclaimed`
 * dalı). Admin de ödeyemez — müşterinin adına sözleşme onayı verilemez. Takım
 * teklifinde ödemeyi owner/admin, `member` ise yalnız takım açıkça izin
 * verdiyse başlatabilir; `viewer` rolü hiç (`forEdit` onu zaten 404'e düşürür).
 *
 * ÖDEYEN = `orders.userId`: aşağıda servise geçen `userId` DAİMA oturumun
 * kullanıcısıdır, teklifin sahibi değil (değişmez 3).
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  CUSTOMER_PAYMENT_FAILED_ERROR,
  handleRouteFailure,
} from "@/lib/api/route-error";
import { canCheckoutQuote, canEditTeamQuote } from "@/lib/config/quote-team";
import { getSessionUser } from "@/lib/services/customer-auth";
import {
  cancelPendingQuoteCheckout,
  createQuoteCheckout,
} from "@/lib/services/quote-checkout";
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
  // Kişisel teklifte ifade BUGÜNKÜNE DENK: `isOwner` ancak oturum kullanıcısı
  // `quotes.user_id` ise (ya da teklif anonimse) true döner ve anonim hâli
  // yukarıdaki `quote_unclaimed` dalı çoktan 409'a çevirdi. `access.team`
  // yalnız takım teklifinde ve yalnız üyelikte doludur (bayrak kapalıysa null).
  if (!canCheckoutQuote(viewer, found.access.team)) {
    return NextResponse.json(
      { error: "Bu teklifi ödeme yetkiniz yok.", code: "not_owner" },
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
    // ÖDEYEN: oturumun kullanıcısı. Teklifin sahibine ÇEVRİLMEZ (değişmez 3).
    userId: session.userId,
    email: session.email,
    input: parsed.data,
    req: request,
    // Yetki servise ROL olarak geçer, boolean olarak değil: servis kapıyı
    // İKİNCİ kez saf yüklemle sorar (uç dışından da çağrılabilir).
    actor: {
      role: found.access.team?.role ?? null,
      memberCanCheckout: found.access.team?.memberCanCheckout ?? false,
    },
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

/**
 * `DELETE /api/quotes/[id]/checkout` — hiç başlamamış kart ödemesini iptal
 * eder.
 *
 * Yöntem değiştirmenin tek kapısı: bekleyen taslak dururken teklif salt
 * okunurdur ve POST farklı yöntemli isteği 409 ile reddeder. Neyin iptal
 * edilebileceğine servis karar verir, burada ikinci bir politika yoktur.
 *
 * KAPI BURADA KABA, SERVİSTE KESİN (0072): `member` yalnız KENDİ başlattığı
 * taslağı iptal eder ve o karar taslağın satırına bağlı — taslağı bu uçta
 * okumak, servisin işlemiyle yarışan ikinci bir okuma olurdu. Burada tutulan
 * şey "bu istek o kararı SORABİLİR mi": kişisel sahip ya da teklifi
 * DÜZENLEYEBİLEN bir takım üyesi. İptal teklifin kilidini açtığı için ölçü
 * `canEditTeamQuote`tır; admin ve paylaşım izleyicisi buradan geçmez.
 */
async function handleDELETE(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
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

  const mayAsk =
    canEditTeamQuote(viewer) && (viewer.isTeam || quote.userId === session.userId);
  if (!mayAsk) {
    return NextResponse.json(
      { error: "Bu teklifi değiştirme yetkiniz yok.", code: "not_owner" },
      { status: 403 }
    );
  }

  const result = await cancelPendingQuoteCheckout({
    quoteId: quote.id,
    userId: session.userId,
    actorRole: found.access.team?.role ?? null,
  });
  return NextResponse.json({ ok: true, reference: result.reference });
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  try {
    return await quoteRouteBody(() => handleDELETE(request, ctx));
  } catch (e) {
    return handleRouteFailure(
      e,
      "DELETE /api/quotes/[id]/checkout",
      CUSTOMER_PAYMENT_FAILED_ERROR
    );
  }
}
